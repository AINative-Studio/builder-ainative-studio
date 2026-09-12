/**
 * GET /api/build/backlog — real BuildTask wiring (#670).
 *
 * Real gap found live: this endpoint's "queued" items were purely computed
 * strings — Cody's chat replies (via /api/build/ask) cited them as "actively
 * queued for the next nightly loop," but no code path ever created a
 * BuildTask row, so runTaskResolutions() (the real nightly loop) never picked
 * them up. Confirmed by grep: zero createTask() call sites anywhere in the
 * backlog system prior to this fix.
 *
 * Properties under test (network + auth MOCKED):
 *   - once a company is on a paid plan + has a domain (the same gate the
 *     'gate' message already claims), each queued item gets a real
 *     createTask() call with stage 'todo' so the nightly loop picks it up,
 *   - idempotent: an item whose title already has a task in this scope is
 *     never re-created,
 *   - no session, or not yet paid+domain (still blocked) → no task creation
 *     at all — never fabricates queued work that isn't eligible yet.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveApp: vi.fn(),
  createTask: vi.fn(),
  listTasks: vi.fn(),
  deriveOwnerKey: vi.fn(() => 'owner'),
  chatScopeKey: vi.fn(() => 'scope-key'),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/build/task-store', () => ({
  createTask: h.createTask,
  listTasks: h.listTasks,
}))
vi.mock('@/lib/build/chat-store', () => ({
  deriveOwnerKey: h.deriveOwnerKey,
  chatScopeKey: h.chatScopeKey,
}))

import { GET } from '@/app/api/build/backlog/route'

function req(url: string) {
  return { url } as any
}

beforeEach(() => {
  h.auth.mockReset()
  h.resolveApp.mockReset()
  h.createTask.mockReset().mockResolvedValue(null)
  h.listTasks.mockReset().mockResolvedValue([])
})

describe('GET /api/build/backlog — real task wiring (#670)', () => {
  it('creates a real todo task for each queued item once paid + domain', async () => {
    h.auth.mockResolvedValue({ user: { email: 'founder@example.com' } })
    h.resolveApp.mockResolvedValue({ zerodbProjectId: 'proj_1', domain: 'acme.com', plan: 'launch' })

    const res = await GET(req('http://x/api/build/backlog?idea=CRM+for+sales+teams&companyName=Acme&companyId=acme'))
    const body = await res.json()

    expect(body.queued.every((i: any) => i.status === 'queued')).toBe(true)
    expect(h.createTask).toHaveBeenCalled()
    const titles = h.createTask.mock.calls.map((c: any[]) => c[1].title)
    for (const item of body.queued) {
      expect(titles).toContain(item.title)
    }
    // Every created task is a real todo the nightly loop will pick up.
    for (const call of h.createTask.mock.calls) {
      expect(call[1].stage).toBe('todo')
      expect(call[0]).toBe('scope-key')
    }
  })

  it('never creates duplicate tasks for items already tracked in this scope', async () => {
    h.auth.mockResolvedValue({ user: { email: 'founder@example.com' } })
    h.resolveApp.mockResolvedValue({ zerodbProjectId: 'proj_1', domain: 'acme.com', plan: 'launch' })
    h.listTasks.mockResolvedValue([
      { id: 't1', scopeKey: 'scope-key', title: 'Authentication + user accounts (OAuth, JWT, sessions)', stage: 'todo', source: 'cody', createdAt: '', updatedAt: '' },
    ])

    await GET(req('http://x/api/build/backlog?idea=CRM&companyName=Acme&companyId=acme'))

    const titles = h.createTask.mock.calls.map((c: any[]) => c[1].title)
    expect(titles).not.toContain('Authentication + user accounts (OAuth, JWT, sessions)')
  })

  it('creates no tasks when not signed in, even if the company is paid + has a domain', async () => {
    h.auth.mockResolvedValue(null)
    h.resolveApp.mockResolvedValue({ zerodbProjectId: 'proj_1', domain: 'acme.com', plan: 'launch' })

    await GET(req('http://x/api/build/backlog?idea=CRM&companyName=Acme&companyId=acme'))

    expect(h.createTask).not.toHaveBeenCalled()
  })

  it('creates no tasks while still blocked (no plan or no domain)', async () => {
    h.auth.mockResolvedValue({ user: { email: 'founder@example.com' } })
    h.resolveApp.mockResolvedValue({ zerodbProjectId: 'proj_1', domain: null, plan: null })

    const res = await GET(req('http://x/api/build/backlog?idea=CRM&companyName=Acme&companyId=acme'))
    const body = await res.json()

    expect(body.queued.every((i: any) => i.status === 'blocked')).toBe(true)
    expect(h.createTask).not.toHaveBeenCalled()
  })

  it('creates no tasks when no companyId is given at all (no scope to key on)', async () => {
    h.auth.mockResolvedValue({ user: { email: 'founder@example.com' } })

    await GET(req('http://x/api/build/backlog?idea=CRM&companyName=Acme'))

    expect(h.createTask).not.toHaveBeenCalled()
    expect(h.resolveApp).not.toHaveBeenCalled()
  })
})
