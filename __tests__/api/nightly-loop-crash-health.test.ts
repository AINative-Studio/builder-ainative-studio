import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Real gap found this hourly run, reading app/api/build/nightly-loop/route.ts
 * directly: its outer catch block logged the error and returned 500, but
 * never called recordRunHealth() -- #1130/#1134's whole point (give a shard
 * invocation's health a persisted home, since Railway cron has no reachable
 * log) had a hole exactly where it mattered most. A shard that crashes
 * outright (not merely degraded -- budget-exhausted, stalled companies, etc,
 * all already captured by the success path) left ZERO trace in the
 * run-health history #1142's admin API reads back. Fixed by recording a
 * `crashed: true` row with whatever's known (shard identity, elapsed time,
 * the error message) instead of nothing at all.
 */

const h = vi.hoisted(() => ({
  listEnrolled: vi.fn(),
  recordRun: vi.fn(),
  recordRunHealth: vi.fn(),
  listRecentRuns: vi.fn(),
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

vi.mock('@/lib/build/loop-enrollment', () => ({
  listEnrolled: h.listEnrolled, recordRun: h.recordRun, listRecentRuns: h.listRecentRuns, recordRunHealth: h.recordRunHealth,
}))
vi.mock('@/lib/build/autonomous-loop', () => ({
  runNightlyLoop: h.runNightlyLoop,
  buildNightlySeedDescription: async (_s: string, input: any) => `desc for ${input.companyName}`,
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

function req(url = 'https://x/api/build/nightly-loop') {
  return {
    url,
    headers: { get: () => null },
    nextUrl: new URL(url),
  } as any
}

describe('nightly-loop route — crashed-run health recording', () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset())
    delete process.env.CRON_SECRET
    h.recordRunHealth.mockResolvedValue(undefined)
  })

  it('records a crashed:true health row (not nothing) when the whole invocation throws', async () => {
    h.listEnrolled.mockRejectedValue(new Error('ZeroDB unreachable'))

    const res = await GET(req())

    expect(res.status).toBe(500)
    expect(h.recordRunHealth).toHaveBeenCalledTimes(1)
    expect(h.recordRunHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        crashed: true,
        errorMessage: 'ZeroDB unreachable',
        enrolled: 0,
        processed: 0,
      })
    )
  })

  it('still records shard identity on a crash when shard params were provided', async () => {
    h.listEnrolled.mockRejectedValue(new Error('boom'))

    await GET(req('https://x/api/build/nightly-loop?shard=2&shards=4'))

    expect(h.recordRunHealth).toHaveBeenCalledWith(
      expect.objectContaining({ shardIndex: 2, shardCount: 4, crashed: true })
    )
  })

  it('does not record crashed:true on a normal successful run', async () => {
    h.listEnrolled.mockResolvedValue([])

    await GET(req())

    expect(h.recordRunHealth).toHaveBeenCalledTimes(1)
    expect(h.recordRunHealth).toHaveBeenCalledWith(
      expect.not.objectContaining({ crashed: true })
    )
  })
})
