import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * GET/POST /api/build/nightly-loop — backlog-seeding fix (#898).
 *
 * REAL BUG: the nightly loop dispatched a real swarm task to every enrolled
 * company every night (confirmed in production), but nothing ever created a
 * `todo` row in build_tasks — so runTaskResolutions() (#433), which only
 * resolves EXISTING `todo` tasks via the real implement→Gitea-commit→
 * coverage-verify pipeline (task-resolver.ts), always found nothing to do.
 * tasksAttempted:0/tasksCompleted:0 on every successful run for weeks, for
 * all 77 enrolled companies, confirmed via GH Actions run logs + a direct
 * ZeroDB query against build_tasks (10 stale rows total, none from any real
 * enrolled company).
 *
 * THE FIX: seed a real `todo` task using the exact same description text
 * already generated for the swarm dispatch (autonomous-loop.ts's
 * buildTaskDescription), for 'app'-track companies only — the resolver's
 * pipeline commits a code diff and coverage-gates it, which only makes sense
 * for an app's "bug fix / UX polish / small feature" description, not the
 * 'company' track's business-ops description (positioning, pipeline,
 * outreach), which has no repo to commit into.
 */

const h = vi.hoisted(() => ({
  listEnrolled: vi.fn(),
  recordRun: vi.fn(),
  runNightlyLoop: vi.fn(),
  appendAutoRunEvent: vi.fn(),
  createDocument: vi.fn(),
  hasReportForDate: vi.fn(),
  pruneDuplicateReports: vi.fn(),
  runMediaRoutines: vi.fn(),
  runTaskResolutions: vi.fn(),
  resolveApp: vi.fn(),
  runNightlyCommsOutreach: vi.fn(),
  createTask: vi.fn(),
  listTasks: vi.fn(),
}))

vi.mock('@/lib/build/loop-enrollment', () => ({ listEnrolled: h.listEnrolled, recordRun: h.recordRun }))
vi.mock('@/lib/build/autonomous-loop', () => ({
  runNightlyLoop: h.runNightlyLoop,
  buildNightlySeedDescription: async (_scopeKey: string, input: any, briefing: string | null) =>
    `desc for ${input.companyName}${briefing ? ` (${briefing})` : ''}`,
}))
vi.mock('@/lib/build/auto-mode', () => ({ appendAutoRunEvent: h.appendAutoRunEvent }))
vi.mock('@/lib/build/auto-run-activity', () => ({ dispatchEventTitle: () => 'Dispatched' }))
vi.mock('@/lib/build/document-store', () => ({
  createDocument: h.createDocument,
  hasReportForDate: h.hasReportForDate,
  pruneDuplicateReports: h.pruneDuplicateReports,
}))
vi.mock('@/lib/build/media-routine', () => ({ runMediaRoutines: h.runMediaRoutines }))
vi.mock('@/lib/build/task-resolution-loop', () => ({ runTaskResolutions: h.runTaskResolutions }))
vi.mock('@/lib/build/task-store', () => ({ createTask: h.createTask, listTasks: h.listTasks }))
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/build/comms-policy', () => ({ runNightlyCommsOutreach: h.runNightlyCommsOutreach }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { GET } from '@/app/api/build/nightly-loop/route'

function req(headers: Record<string, string> = {}) {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? headers[k] ?? null },
  } as any
}

const APP_ENROLLMENT = {
  companyId: 'beacon', companyName: 'Beacon', track: 'app' as const,
  ownerKey: 'founder@beacon.co', enabled: true, enrolledAt: '2026-09-01T00:00:00Z',
}
const COMPANY_ENROLLMENT = {
  companyId: 'acme-co', companyName: 'Acme Co', track: 'company' as const,
  ownerKey: 'founder@acme.co', enabled: true, enrolledAt: '2026-09-01T00:00:00Z',
}

describe('GET /api/build/nightly-loop — backlog task seeding (#898)', () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset())
    delete process.env.CRON_SECRET
    h.listEnrolled.mockResolvedValue([APP_ENROLLMENT])
    h.recordRun.mockResolvedValue(undefined)
    h.runNightlyLoop.mockResolvedValue({
      companyId: 'beacon', briefing: 'real briefing', taskId: 'task-1', status: 'dispatched', detail: 'ok',
    })
    h.appendAutoRunEvent.mockResolvedValue(undefined)
    h.hasReportForDate.mockResolvedValue(true) // keep unrelated report-writing quiet for these tests
    h.createDocument.mockResolvedValue({ id: 'd1' })
    h.pruneDuplicateReports.mockResolvedValue(undefined)
    h.runMediaRoutines.mockResolvedValue({ generated: 0 })
    h.runTaskResolutions.mockResolvedValue({ attempted: 0, completed: 0 })
    h.resolveApp.mockResolvedValue(null)
    h.runNightlyCommsOutreach.mockResolvedValue({ status: 'skipped', reason: 'no_genuine_update' })
    h.listTasks.mockResolvedValue([])
    h.createTask.mockResolvedValue({ id: 't1' })
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('seeds a real todo task for an app-track company using the swarm-dispatch description', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(h.createTask).toHaveBeenCalledTimes(1)
    const [scopeKey, input] = h.createTask.mock.calls[0]
    expect(scopeKey).toEqual(expect.any(String))
    expect(input).toMatchObject({
      title: 'Nightly backlog: Beacon',
      detail: 'desc for Beacon (real briefing)',
      stage: 'todo',
      source: 'recurring',
    })
  })

  it('never seeds a task for a company-track enrollment — no repo to commit a diff into', async () => {
    h.listEnrolled.mockResolvedValue([COMPANY_ENROLLMENT])
    await GET(req())
    expect(h.createTask).not.toHaveBeenCalled()
  })

  it('idempotent: skips seeding when an unresolved recurring todo task already exists', async () => {
    h.listTasks.mockResolvedValue([
      { id: 'existing', scopeKey: 'x', title: 't', stage: 'todo', source: 'recurring', createdAt: '', updatedAt: '' },
    ])
    await GET(req())
    expect(h.createTask).not.toHaveBeenCalled()
  })

  it('idempotent: skips seeding when an unresolved recurring in_progress task already exists', async () => {
    h.listTasks.mockResolvedValue([
      { id: 'existing', scopeKey: 'x', title: 't', stage: 'in_progress', source: 'recurring', createdAt: '', updatedAt: '' },
    ])
    await GET(req())
    expect(h.createTask).not.toHaveBeenCalled()
  })

  it('does NOT count a completed/failed/rejected recurring task as "unresolved" — seeds a fresh one', async () => {
    h.listTasks.mockResolvedValue([
      { id: 'old', scopeKey: 'x', title: 't', stage: 'completed', source: 'recurring', createdAt: '', updatedAt: '' },
    ])
    await GET(req())
    expect(h.createTask).toHaveBeenCalledTimes(1)
  })

  it('does NOT count a todo task from a DIFFERENT source (cody/swarm) as blocking — only recurring counts', async () => {
    h.listTasks.mockResolvedValue([
      { id: 'manual', scopeKey: 'x', title: 't', stage: 'todo', source: 'cody', createdAt: '', updatedAt: '' },
    ])
    await GET(req())
    expect(h.createTask).toHaveBeenCalledTimes(1)
  })

  it('never seeds a task for a company with no ownerKey — no scope to key it by', async () => {
    h.listEnrolled.mockResolvedValue([{ ...APP_ENROLLMENT, ownerKey: undefined }])
    await GET(req())
    expect(h.createTask).not.toHaveBeenCalled()
  })

  it('a createTask failure never breaks the rest of the nightly loop', async () => {
    h.createTask.mockRejectedValue(new Error('zerodb down'))
    const res = await GET(req())
    expect(res.status).toBe(200)
  })

  it('a listTasks failure never breaks the rest of the nightly loop', async () => {
    h.listTasks.mockRejectedValue(new Error('zerodb down'))
    const res = await GET(req())
    expect(res.status).toBe(200)
  })

  it('the existing task-resolution step still runs afterward, independent of seeding', async () => {
    h.runTaskResolutions.mockResolvedValue({ attempted: 1, completed: 1 })
    const res = await GET(req())
    const data = await res.json()
    expect(data.tasksAttempted).toBe(1)
    expect(data.tasksCompleted).toBe(1)
  })
})
