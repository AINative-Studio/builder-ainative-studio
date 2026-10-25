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
 * buildTaskDescription), for 'app'-track companies — the resolver's
 * pipeline commits a code diff and coverage-gates it, matching an app's
 * "bug fix / UX polish / small feature" description.
 *
 * #1521 — 'company' track had the identical real gap: the swarm dispatch
 * above (dispatchSwarmTask → runNightlyLoop) is real work with a real
 * task_id, but nothing ever recorded it as a build_tasks row, so every
 * company-track founder's backlog showed empty every night regardless of
 * plan — confirmed live against the real ZeroDB builder_app_registry/
 * build_tasks/builder_loop_enrollments tables: all 11 genuinely external
 * paying companies had real nightly run-event history with
 * status:'dispatched' going back weeks, work was never missing, only its
 * visibility. Company-track has no separate resolver pipeline to pick a
 * seeded task up later (unlike app-track's runTaskResolutions), so it:
 * (1) trues up the PRIOR night's row to its real current stage via the same
 * core status-read endpoint (readTaskStatus) assessSwarmHealth already uses,
 * so a founder sees real todo→in_progress→completed/failed transitions
 * across nights; (2) seeds tonight's row already reflecting the dispatch
 * that just happened (stage 'in_progress', not 'todo' — the work already
 * started, unlike app-track where a resolver picks it up later).
 */

const h = vi.hoisted(() => ({
  listEnrolled: vi.fn(),
  recordRun: vi.fn(),
  recordRunHealth: vi.fn(),
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
  updateTask: vi.fn(),
  readTaskStatus: vi.fn(),
  getAinativeApiKey: vi.fn(),
}))

vi.mock('@/lib/build/loop-enrollment', () => ({ listEnrolled: h.listEnrolled, recordRun: h.recordRun, recordRunHealth: h.recordRunHealth }))
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
vi.mock('@/lib/build/task-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/build/task-store')>()
  return { ...actual, createTask: h.createTask, listTasks: h.listTasks, updateTask: h.updateTask }
})
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/build/comms-policy', () => ({ runNightlyCommsOutreach: h.runNightlyCommsOutreach }))
vi.mock('@/lib/build/swarm-task-health', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/build/swarm-task-health')>()
  return { ...actual, readTaskStatus: h.readTaskStatus }
})
vi.mock('@/lib/build/env-keys', () => ({ getAinativeApiKey: h.getAinativeApiKey }))
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
    h.recordRunHealth.mockResolvedValue(undefined)
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
    h.updateTask.mockResolvedValue(true)
    h.readTaskStatus.mockResolvedValue({ taskId: 'prior-task', dispatchedAt: '', status: 'unknown' })
    h.getAinativeApiKey.mockReturnValue('test-key')
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

  it('#1521 — seeds a real in_progress task for a company-track enrollment, reflecting the dispatch that already happened', async () => {
    h.listEnrolled.mockResolvedValue([COMPANY_ENROLLMENT])
    h.runNightlyLoop.mockResolvedValue({
      companyId: 'acme-co', briefing: 'real briefing', taskId: 'swarm-task-9', status: 'dispatched', detail: 'ok',
    })
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(h.createTask).toHaveBeenCalledTimes(1)
    const [scopeKey, input] = h.createTask.mock.calls[0]
    expect(scopeKey).toEqual(expect.any(String))
    expect(input).toMatchObject({
      title: 'Nightly backlog: Acme Co',
      detail: 'desc for Acme Co (real briefing)',
      stage: 'in_progress',
      source: 'recurring',
      taskId: 'swarm-task-9',
    })
  })

  it('#1521 — never seeds a company-track task when the dispatch itself failed (no real taskId to track)', async () => {
    h.listEnrolled.mockResolvedValue([COMPANY_ENROLLMENT])
    h.runNightlyLoop.mockResolvedValue({
      companyId: 'acme-co', briefing: null, taskId: null, status: 'error', detail: 'task submit failed',
    })
    await GET(req())
    expect(h.createTask).not.toHaveBeenCalled()
  })

  it('#1521 — true-up: a prior unresolved company-track row is updated to its real stage via readTaskStatus before seeding a new one', async () => {
    h.listEnrolled.mockResolvedValue([COMPANY_ENROLLMENT])
    h.listTasks.mockResolvedValue([
      { id: 'prior', scopeKey: 'x', title: 'Nightly backlog: Acme Co', stage: 'in_progress', source: 'recurring', taskId: 'swarm-task-8', createdAt: '', updatedAt: '2026-10-23T00:00:00Z' },
    ])
    h.readTaskStatus.mockResolvedValue({ taskId: 'swarm-task-8', dispatchedAt: '2026-10-23T00:00:00Z', status: 'completed' })
    h.runNightlyLoop.mockResolvedValue({
      companyId: 'acme-co', briefing: null, taskId: 'swarm-task-9', status: 'dispatched', detail: 'ok',
    })
    await GET(req())

    expect(h.readTaskStatus).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'swarm-task-8' }),
      'test-key',
    )
    expect(h.updateTask).toHaveBeenCalledWith('founder@acme.co::acme-co', 'prior', { stage: 'completed' })
    // The prior row genuinely finished -> a fresh row is seeded for tonight's dispatch.
    expect(h.createTask).toHaveBeenCalledTimes(1)
  })

  it('#1521 — a prior row still genuinely running (readTaskStatus says in_progress) blocks a duplicate seed, same idempotency guard as app-track', async () => {
    h.listEnrolled.mockResolvedValue([COMPANY_ENROLLMENT])
    h.listTasks.mockResolvedValue([
      { id: 'prior', scopeKey: 'x', title: 'Nightly backlog: Acme Co', stage: 'in_progress', source: 'recurring', taskId: 'swarm-task-8', createdAt: '', updatedAt: '2026-10-23T00:00:00Z' },
    ])
    h.readTaskStatus.mockResolvedValue({ taskId: 'swarm-task-8', dispatchedAt: '2026-10-23T00:00:00Z', status: 'running' })
    await GET(req())

    expect(h.updateTask).not.toHaveBeenCalled() // already in_progress, no real stage change
    expect(h.createTask).not.toHaveBeenCalled()
  })

  it('#1521 — a prior row that genuinely failed updates to failed, then still seeds a fresh task (does not get stuck)', async () => {
    h.listEnrolled.mockResolvedValue([COMPANY_ENROLLMENT])
    h.listTasks.mockResolvedValue([
      { id: 'prior', scopeKey: 'x', title: 'Nightly backlog: Acme Co', stage: 'todo', source: 'recurring', taskId: 'swarm-task-8', createdAt: '', updatedAt: '2026-10-23T00:00:00Z' },
    ])
    h.readTaskStatus.mockResolvedValue({ taskId: 'swarm-task-8', dispatchedAt: '2026-10-23T00:00:00Z', status: 'failed' })
    h.runNightlyLoop.mockResolvedValue({
      companyId: 'acme-co', briefing: null, taskId: 'swarm-task-9', status: 'dispatched', detail: 'ok',
    })
    await GET(req())

    expect(h.updateTask).toHaveBeenCalledWith('founder@acme.co::acme-co', 'prior', { stage: 'failed' })
    expect(h.createTask).toHaveBeenCalledTimes(1)
  })

  it('#1521 — no API key configured: skips the status-read entirely but still seeds tonight\'s row when there is no prior unresolved task', async () => {
    h.listEnrolled.mockResolvedValue([COMPANY_ENROLLMENT])
    h.getAinativeApiKey.mockReturnValue('')
    h.runNightlyLoop.mockResolvedValue({
      companyId: 'acme-co', briefing: null, taskId: 'swarm-task-9', status: 'dispatched', detail: 'ok',
    })
    await GET(req())

    expect(h.readTaskStatus).not.toHaveBeenCalled()
    expect(h.createTask).toHaveBeenCalledTimes(1)
  })

  it('#1521 — a readTaskStatus failure degrades honestly: never throws, never advances the prior row\'s stage, blocks a duplicate seed', async () => {
    h.listEnrolled.mockResolvedValue([COMPANY_ENROLLMENT])
    h.listTasks.mockResolvedValue([
      { id: 'prior', scopeKey: 'x', title: 'Nightly backlog: Acme Co', stage: 'in_progress', source: 'recurring', taskId: 'swarm-task-8', createdAt: '', updatedAt: '2026-10-23T00:00:00Z' },
    ])
    h.readTaskStatus.mockRejectedValue(new Error('core down'))
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(h.updateTask).not.toHaveBeenCalled()
    expect(h.createTask).not.toHaveBeenCalled()
  })

  it('#1521 — a company-track task from a DIFFERENT source (cody/swarm) is never treated as the recurring prior row', async () => {
    h.listEnrolled.mockResolvedValue([COMPANY_ENROLLMENT])
    h.listTasks.mockResolvedValue([
      { id: 'manual', scopeKey: 'x', title: 't', stage: 'in_progress', source: 'swarm', taskId: 'swarm-task-7', createdAt: '', updatedAt: '' },
    ])
    h.runNightlyLoop.mockResolvedValue({
      companyId: 'acme-co', briefing: null, taskId: 'swarm-task-9', status: 'dispatched', detail: 'ok',
    })
    await GET(req())

    expect(h.readTaskStatus).not.toHaveBeenCalled() // not a 'recurring' row, ignored
    expect(h.createTask).toHaveBeenCalledTimes(1) // no blocking prior -> seeds fresh
  })

  it('#1521 — a company-track updateTask/createTask failure never breaks the rest of the nightly loop', async () => {
    h.listEnrolled.mockResolvedValue([COMPANY_ENROLLMENT])
    h.listTasks.mockResolvedValue([
      { id: 'prior', scopeKey: 'x', title: 't', stage: 'in_progress', source: 'recurring', taskId: 'swarm-task-8', createdAt: '', updatedAt: '' },
    ])
    h.readTaskStatus.mockResolvedValue({ taskId: 'swarm-task-8', dispatchedAt: '', status: 'completed' })
    h.updateTask.mockRejectedValue(new Error('zerodb down'))
    const res = await GET(req())
    expect(res.status).toBe(200)
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

  // #1232 — the route must surface real merge/deploy outcomes, not just
  // coverage-pass counts, so an admin can see real ship rate.
  it('aggregates tasksMerged/tasksRedeployed from runTaskResolutions into the response', async () => {
    h.runTaskResolutions.mockResolvedValue({ attempted: 1, completed: 1, merged: 1, redeployed: 1 })
    const res = await GET(req())
    const data = await res.json()
    expect(data.tasksMerged).toBe(1)
    expect(data.tasksRedeployed).toBe(1)
  })

  it('reports tasksMerged: 0 when a task completed (coverage-verified) but never merged — the real #1232 gap case', async () => {
    h.runTaskResolutions.mockResolvedValue({ attempted: 1, completed: 1, merged: 0, redeployed: 0 })
    const res = await GET(req())
    const data = await res.json()
    expect(data.tasksCompleted).toBe(1)
    expect(data.tasksMerged).toBe(0)
    expect(data.tasksRedeployed).toBe(0)
  })

  it('never throws when runTaskResolutions resolves without merged/redeployed fields (older mock/shape)', async () => {
    h.runTaskResolutions.mockResolvedValue({ attempted: 1, completed: 1 })
    const res = await GET(req())
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.tasksMerged).toBe(0)
    expect(data.tasksRedeployed).toBe(0)
  })
})
