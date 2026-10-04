import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * GET/POST /api/build/nightly-loop — plan-tier-aware task-resolution
 * throughput (#908, epic #900).
 *
 * THE GAP: lib/build/task-resolution-loop.ts's runTaskResolutions() became
 * plan-aware (maxTasksForTier()) but this route — its ONLY real caller — never
 * resolved or passed a plan tier, so the new logic was dead code; every
 * company still got the free-tier ceiling regardless of what they pay for.
 *
 * THE FIX: this cron has no founder session to resolve a plan from the usual
 * way (lib/ainative/active-plan.ts's resolveActivePlan() needs one), so the
 * route resolves each enrolled company's plan by OWNER EMAIL via the same
 * admin-scoped, offline-safe lookup lib/build/loop-backfill.ts already
 * established for this exact situation (fetchPlanByEmail → normalizeTier),
 * cached per owner email, and passes the normalized tier into
 * runTaskResolutions().
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
  fetchPlanByEmail: vi.fn(),
}))

vi.mock('@/lib/build/loop-enrollment', () => ({ listEnrolled: h.listEnrolled, recordRun: h.recordRun }))
vi.mock('@/lib/build/autonomous-loop', () => ({
  runNightlyLoop: h.runNightlyLoop,
  buildTaskDescription: (input: any, briefing: string | null) =>
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
vi.mock('@/lib/ainative/admin-plan-lookup', () => ({ fetchPlanByEmail: h.fetchPlanByEmail }))
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

describe('GET /api/build/nightly-loop — plan-tier-aware task throughput (#908)', () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset())
    delete process.env.CRON_SECRET
    h.listEnrolled.mockResolvedValue([APP_ENROLLMENT])
    h.recordRun.mockResolvedValue(undefined)
    h.runNightlyLoop.mockResolvedValue({
      companyId: 'beacon', briefing: 'real briefing', taskId: 'task-1', status: 'dispatched', detail: 'ok',
    })
    h.appendAutoRunEvent.mockResolvedValue(undefined)
    h.hasReportForDate.mockResolvedValue(true)
    h.createDocument.mockResolvedValue({ id: 'd1' })
    h.pruneDuplicateReports.mockResolvedValue(undefined)
    h.runMediaRoutines.mockResolvedValue({ generated: 0 })
    h.runTaskResolutions.mockResolvedValue({ attempted: 0, completed: 0 })
    h.resolveApp.mockResolvedValue(null)
    h.runNightlyCommsOutreach.mockResolvedValue({ status: 'skipped', reason: 'no_genuine_update' })
    h.listTasks.mockResolvedValue([])
    h.createTask.mockResolvedValue({ id: 't1' })
    h.fetchPlanByEmail.mockResolvedValue({ plan: 'hobbyist', email: 'founder@beacon.co', verified: true })
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('resolves the company owner\'s real plan tier and passes it into runTaskResolutions', async () => {
    h.fetchPlanByEmail.mockResolvedValue({ plan: 'enterprise', email: 'founder@beacon.co', verified: true })
    await GET(req())
    expect(h.fetchPlanByEmail).toHaveBeenCalledWith('founder@beacon.co')
    expect(h.runTaskResolutions).toHaveBeenCalledWith(expect.any(String), 'beacon', 'enterprise')
  })

  it('normalizes a core alias (launch/company) before passing it through', async () => {
    h.fetchPlanByEmail.mockResolvedValue({ plan: 'launch', email: 'founder@beacon.co', verified: true })
    await GET(req())
    expect(h.runTaskResolutions).toHaveBeenCalledWith(expect.any(String), 'beacon', 'pro')
  })

  it('a plan-lookup that could not verify (verified:false) degrades to null — never fabricates a tier', async () => {
    h.fetchPlanByEmail.mockResolvedValue({ plan: null, email: null, verified: false, reason: 'http_500' })
    await GET(req())
    expect(h.runTaskResolutions).toHaveBeenCalledWith(expect.any(String), 'beacon', null)
  })

  it('a fetchPlanByEmail rejection degrades to null rather than throwing out of the loop', async () => {
    h.fetchPlanByEmail.mockRejectedValue(new Error('core unreachable'))
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(h.runTaskResolutions).toHaveBeenCalledWith(expect.any(String), 'beacon', null)
  })

  it('a guest ownerKey (no real email) skips the lookup entirely and degrades to null', async () => {
    h.listEnrolled.mockResolvedValue([{ ...APP_ENROLLMENT, ownerKey: 'guest:anon' }])
    await GET(req())
    expect(h.fetchPlanByEmail).not.toHaveBeenCalled()
    expect(h.runTaskResolutions).toHaveBeenCalledWith(expect.any(String), 'beacon', null)
  })

  it('a missing ownerKey skips the lookup and degrades to null (runTaskResolutions itself already no-ops without ownerKey upstream)', async () => {
    h.listEnrolled.mockResolvedValue([{ ...APP_ENROLLMENT, ownerKey: undefined }])
    await GET(req())
    expect(h.fetchPlanByEmail).not.toHaveBeenCalled()
  })

  it('caches the plan lookup per owner email across multiple enrolled companies for the same founder', async () => {
    h.listEnrolled.mockResolvedValue([
      APP_ENROLLMENT,
      { ...APP_ENROLLMENT, companyId: 'beacon-2', companyName: 'Beacon Two' },
    ])
    await GET(req())
    expect(h.fetchPlanByEmail).toHaveBeenCalledTimes(1)
    expect(h.runTaskResolutions).toHaveBeenCalledTimes(2)
  })

  it('a runTaskResolutions failure for one company never breaks the rest of the nightly loop', async () => {
    h.runTaskResolutions.mockRejectedValue(new Error('resolver down'))
    const res = await GET(req())
    expect(res.status).toBe(200)
  })
})
