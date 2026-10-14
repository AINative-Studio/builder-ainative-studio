/**
 * #1086 — GET /api/build/tasks is now COMPANY-scoped (every owner's rows for
 * a company, incl. the Gitea webhook's synthetic rows), not gated by the
 * viewing session's own {owner}::{company} scope key (the real secondary bug
 * the issue called out: a different session viewing the same company used to
 * see stale/empty data). PATCH is updated to look the task up company-wide
 * first so it can still write to a row created under a DIFFERENT owner's
 * scope key (e.g. a teammate's session, or a Gitea-sourced synthetic row).
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  createTask: vi.fn(),
  listTasksForCompany: vi.fn(),
  updateTask: vi.fn(),
  isEnrolled: vi.fn(async () => false),
  getLastRun: vi.fn(async () => null),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/loop-enrollment', () => ({
  isEnrolled: h.isEnrolled,
  getLastRun: h.getLastRun,
}))
vi.mock('@/lib/build/task-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/task-store')>('@/lib/build/task-store')
  return {
    ...actual,
    createTask: h.createTask,
    listTasksForCompany: h.listTasksForCompany,
    updateTask: h.updateTask,
  }
})

import { GET, POST, PATCH } from '@/app/api/build/tasks/route'

function getReq(url: string) {
  return { nextUrl: new URL(url) } as any
}
function postReq(body: unknown) {
  return { json: async () => body } as any
}

const mkTask = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  scopeKey: 'founderA@x.com::acme',
  title: 'A task',
  stage: 'todo',
  source: 'cody',
  taskId: null,
  storyPoints: null,
  estimateRationale: null,
  giteaBranch: null,
  giteaSynthetic: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
})

describe('GET /api/build/tasks (#1086 — company-wide read)', () => {
  beforeEach(() => {
    h.auth.mockReset().mockResolvedValue({ user: { email: 'founderB@x.com' } })
    h.listTasksForCompany.mockReset().mockResolvedValue([])
    h.isEnrolled.mockReset().mockResolvedValue(false)
    h.getLastRun.mockReset().mockResolvedValue(null)
  })

  it('reads by companySlug directly — does not gate on the viewing session at all', async () => {
    h.listTasksForCompany.mockResolvedValue([mkTask({ id: 'a', scopeKey: 'founderA@x.com::acme' })])
    const res = await GET(getReq('http://x/api/build/tasks?companyId=acme'))
    const json = await res.json()
    expect(h.listTasksForCompany).toHaveBeenCalledWith('acme')
    expect(json.tasks.map((t: any) => t.id)).toContain('a')
  })

  it('a DIFFERENT viewing session than the one that created the task still sees it (the real bug fixed)', async () => {
    // founderB is viewing; the task was created by founderA. Pre-#1086 this
    // would have returned [] because the old GET queried ONLY founderB's own
    // scope key.
    h.auth.mockResolvedValue({ user: { email: 'founderB@x.com' } })
    h.listTasksForCompany.mockResolvedValue([mkTask({ id: 'a', scopeKey: 'founderA@x.com::acme' })])
    const res = await GET(getReq('http://x/api/build/tasks?companyId=acme'))
    const json = await res.json()
    expect(json.tasks.map((t: any) => t.id)).toEqual(['a'])
  })

  it('surfaces Gitea-synthetic rows alongside real tasks', async () => {
    h.listTasksForCompany.mockResolvedValue([
      mkTask({ id: 'real-1' }),
      mkTask({ id: 'synthetic-1', scopeKey: 'git:webhook::acme', giteaSynthetic: true, giteaBranch: 'task/manual-1', source: 'swarm' }),
    ])
    const res = await GET(getReq('http://x/api/build/tasks?companyId=acme'))
    const json = await res.json()
    expect(json.tasks.map((t: any) => t.id).sort()).toEqual(['real-1', 'synthetic-1'])
  })

  it('returns an honest empty backlog for a blank companyId, without calling listTasksForCompany', async () => {
    const res = await GET(getReq('http://x/api/build/tasks'))
    const json = await res.json()
    expect(json.tasks).toEqual([])
    expect(h.listTasksForCompany).not.toHaveBeenCalled()
  })

  it('never 500s when listTasksForCompany rejects — degrades to an empty backlog', async () => {
    h.listTasksForCompany.mockRejectedValue(new Error('zerodb down'))
    const res = await GET(getReq('http://x/api/build/tasks?companyId=acme'))
    const json = await res.json()
    expect(json.tasks).toEqual([])
  })

  it('still filters by ?stage= on the company-wide list', async () => {
    h.listTasksForCompany.mockResolvedValue([
      mkTask({ id: 'a', stage: 'todo' }),
      mkTask({ id: 'b', stage: 'completed' }),
    ])
    const res = await GET(getReq('http://x/api/build/tasks?companyId=acme&stage=completed'))
    const json = await res.json()
    expect(json.tasks.map((t: any) => t.id)).toEqual(['b'])
  })
})

describe('POST /api/build/tasks (#1086 regression — writes stay owner-scoped)', () => {
  beforeEach(() => {
    h.auth.mockReset().mockResolvedValue({ user: { email: 'founderA@x.com' } })
    h.createTask.mockReset().mockResolvedValue(mkTask({ id: 'new-1' }))
  })

  it('still creates under the viewing session\'s own {owner}::{company} scope key', async () => {
    const res = await POST(postReq({ companyId: 'acme', title: 'New task' }))
    const json = await res.json()
    expect(json.task.id).toBe('new-1')
    expect(h.createTask).toHaveBeenCalledWith(
      'foundera@x.com::acme',
      expect.objectContaining({ title: 'New task' }),
    )
  })
})

describe('PATCH /api/build/tasks (#1086 — company-wide lookup before write)', () => {
  beforeEach(() => {
    h.auth.mockReset().mockResolvedValue({ user: { email: 'founderB@x.com' } })
    h.listTasksForCompany.mockReset().mockResolvedValue([])
    h.updateTask.mockReset().mockResolvedValue(true)
  })

  it("writes to the task's REAL persisted scopeKey, even when it differs from the viewing session's own", async () => {
    h.listTasksForCompany.mockResolvedValue([mkTask({ id: 't1', scopeKey: 'founderA@x.com::acme' })])
    const res = await PATCH(postReq({ companyId: 'acme', id: 't1', stage: 'completed' }))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(h.updateTask).toHaveBeenCalledWith('founderA@x.com::acme', 't1', expect.objectContaining({ stage: 'completed' }))
  })

  it('can update a Gitea-synthetic row under its sentinel scope key', async () => {
    h.listTasksForCompany.mockResolvedValue([mkTask({ id: 'synthetic-1', scopeKey: 'git:webhook::acme', giteaSynthetic: true })])
    const res = await PATCH(postReq({ companyId: 'acme', id: 'synthetic-1', stage: 'rejected' }))
    await res.json()
    expect(h.updateTask).toHaveBeenCalledWith('git:webhook::acme', 'synthetic-1', expect.objectContaining({ stage: 'rejected' }))
  })

  it('falls back to the viewing session\'s own scope key when the task has not shown up in a company-wide read yet', async () => {
    h.listTasksForCompany.mockResolvedValue([]) // not found company-wide (e.g. same-request race right after creation)
    const res = await PATCH(postReq({ companyId: 'acme', id: 'brand-new', stage: 'in_progress' }))
    await res.json()
    expect(h.updateTask).toHaveBeenCalledWith('founderb@x.com::acme', 'brand-new', expect.objectContaining({ stage: 'in_progress' }))
  })

  it('rejects an invalid stage before touching the store', async () => {
    const res = await PATCH(postReq({ companyId: 'acme', id: 't1', stage: 'bogus' }))
    expect(res.status).toBe(400)
    expect(h.updateTask).not.toHaveBeenCalled()
  })
})
