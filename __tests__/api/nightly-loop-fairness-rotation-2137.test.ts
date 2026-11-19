import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * GET /api/build/nightly-loop — fairness rotation (#2137).
 *
 * THE BUG: mapWithConcurrency's drain() always starts at index 0 of
 * whatever batch selectShard() hands it, and selectShard's own output
 * order is stable run-to-run (same listEnrolled() row order, same modulo
 * filter). Put those together: once a shard's batch is long enough that
 * its budget/concurrency can't finish it in one run, the companies PAST
 * that cutoff are "deferred" — and because nothing about the list or the
 * cutoff changes between runs, it is the SAME tail companies deferred
 * every single night, forever. That is #2137's live symptom (wrench,
 * tidemark, zova, pathfnd stuck `in_progress`/never-reseeded night after
 * night) — plain positional starvation, no process crash required.
 *
 * The fix (rotateForFairness, concurrent-map.ts) rotates the batch's
 * starting point by a day index each run. These tests prove the route
 * actually wires that in: a company stuck past the cutoff on one "night"
 * gets processed on a later night once the rotation brings it to the
 * front, instead of being stuck forever.
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
  assessSwarmHealth: vi.fn(),
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

// Real mapWithConcurrency/selectShard/rotateForFairness + real report
// builder are deliberately NOT mocked — the point of these tests is the
// real admission-order behaviour.
vi.mock('@/lib/build/swarm-task-health', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/build/swarm-task-health')>()
  return { ...actual, assessSwarmHealth: h.assessSwarmHealth }
})

import { GET } from '@/app/api/build/nightly-loop/route'

function req(url = 'https://x/api/build/nightly-loop') {
  return {
    url,
    headers: { get: () => null },
    nextUrl: new URL(url),
  } as any
}

function enrollment(i: number) {
  return {
    companyId: `co-${i}`, companyName: `Co ${i}`, track: 'company' as const,
    ownerKey: `founder${i}@x.co`, enabled: true, enrolledAt: '2026-09-01T00:00:00Z',
  }
}

const HEALTHY_VERDICT = {
  checked: 0, queued: 0, running: 0, completed: 0, failed: 0, unknown: 0,
  consecutiveUnfinished: 0, oldestQueuedHours: 0, lastCompletedAt: null, stalled: false,
}

const DAY_MS = 86_400_000

describe('nightly-loop route — fairness rotation (#2137)', () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset())
    delete process.env.CRON_SECRET
    // With concurrency 8 and 20 items at 40ms each: batch 0-7 admits at
    // t~0 (deadline 70 > 0), batch 8-15 admits at t~40 (40 < 70), batch
    // 16-19 is checked at t~80 (80 >= 70) and never starts — a reliable,
    // jitter-tolerant margin (40ms of slack either side) rather than a
    // knife-edge timing assumption.
    process.env.NIGHTLY_LOOP_BUDGET_MS = '70'
    h.recordRun.mockResolvedValue(undefined)
    h.recordRunHealth.mockResolvedValue(undefined)
    h.listRecentRuns.mockResolvedValue([])
    h.runNightlyLoop.mockImplementation(async (input: any) => {
      await new Promise((r) => setTimeout(r, 40))
      return { companyId: input.companyId, briefing: null, taskId: 't', status: 'dispatched', detail: 'd' }
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
    h.fetchPlanByEmail.mockResolvedValue({ plan: 'pro', email: 'founder1@x.co', verified: true })
    h.assessSwarmHealth.mockResolvedValue(HEALTHY_VERDICT)
    h.listEnrolled.mockResolvedValue(Array.from({ length: 20 }, (_, i) => enrollment(i)))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.NIGHTLY_LOOP_BUDGET_MS
  })

  /**
   * Pins Date.now()'s epoch-day (the value the route's `dayIndex` is
   * derived from) to exactly `desiredDayIndex`, WITHOUT freezing real
   * elapsed time — fake timers would stop the mocked per-company
   * `setTimeout` delays from ever resolving, but offsetting Date.now() by
   * a fixed amount (computed once, relative to the real clock at the
   * moment this is called) keeps it ticking forward in real time — so the
   * budget/deadline math the route depends on keeps working exactly as it
   * does in production — while landing on a known, controllable day.
   */
  function setSimulatedDay(desiredDayIndex: number) {
    const originalNow = Date.now.bind(Date)
    const offsetMs = desiredDayIndex * DAY_MS - originalNow()
    vi.spyOn(Date, 'now').mockImplementation(() => originalNow() + offsetMs)
  }

  it('a company deferred on one night is not deferred on every subsequent night — no permanent starvation', async () => {
    // "Night 1": day index 0 (no rotation yet) — budget tight enough that
    // co-19 (the last item in the stable 20-company list) is never reached.
    setSimulatedDay(0)
    const night1 = await (await GET(req())).json()
    const night1Ids = new Set<string>(night1.results.map((r: any) => r.companyId))
    expect(night1Ids.has('co-19')).toBe(false) // confirms the deferral actually happens
    expect(night1.deferred).toBeGreaterThan(0)

    // Advance far enough (in whole days) that rotateForFairness's offset
    // brings co-19 to the very front of the batch, guaranteeing it is
    // among the first admitted regardless of the tight budget.
    let processedCo19 = false
    for (let day = 1; day <= 20; day++) {
      setSimulatedDay(day)
      const body = await (await GET(req())).json()
      if (body.results.some((r: any) => r.companyId === 'co-19')) {
        processedCo19 = true
        break
      }
    }
    expect(processedCo19).toBe(true)
  }, 20000)

  it('every company in the batch is still covered exactly once per shard — rotation only reorders, never drops or duplicates', async () => {
    delete process.env.NIGHTLY_LOOP_BUDGET_MS // no deferral this time — want everyone covered in one run
    h.listEnrolled.mockResolvedValue(Array.from({ length: 10 }, (_, i) => enrollment(i)))
    setSimulatedDay(5)
    const body = await (await GET(req('https://x/api/build/nightly-loop?shard=1&shards=3'))).json()
    const seen = new Set<string>(body.results.map((r: any) => r.companyId))
    expect(seen.size).toBe(body.processed)
    // sanity: the shard's membership (which companies land in shard 1 of 3)
    // is unaffected by rotation — still exactly the i%3===1 subset.
    const expectedMembers = new Set(
      Array.from({ length: 10 }, (_, i) => i).filter((i) => i % 3 === 1).map((i) => `co-${i}`),
    )
    expect(seen).toEqual(expectedMembers)
  })
})
