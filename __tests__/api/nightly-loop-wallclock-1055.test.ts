import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * GET/POST /api/build/nightly-loop — bounded wall-clock + stall visibility (#1055).
 *
 * PROBLEM A (confirmed live): 9 of the last 15 scheduled GitHub Action runs
 * died with `curl: (28) Operation timed out after 300001ms`. The route iterated
 * ~77 enrolled companies SERIALLY inside its own 300s maxDuration, which the
 * Action's identical `--max-time 300` then raced. Fix = bounded-concurrency
 * sweep + a real internal deadline + optional shard params so the Action can
 * split the sweep across several smaller calls.
 *
 * PROBLEM B (confirmed live, `mendr`): the per-company report said
 * "dispatched" for 13 straight nights while every dispatched task sat
 * `queued` in core's swarm. Fix = read the real statuses back and surface
 * the aggregate in the report.
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

// Real mapWithConcurrency + real report builder + real health summarizer are
// deliberately NOT mocked — the point of these tests is the real behaviour.
// Only the NETWORK read of core's task status is mocked.
vi.mock('@/lib/build/swarm-task-health', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/build/swarm-task-health')>()
  return { ...actual, assessSwarmHealth: h.assessSwarmHealth }
})

import { GET, NIGHTLY_COMPANY_CONCURRENCY } from '@/app/api/build/nightly-loop/route'

function req(url = 'https://x/api/build/nightly-loop', headers: Record<string, string> = {}) {
  return {
    url,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? headers[k] ?? null },
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
  checked: 2, queued: 1, running: 0, completed: 1, failed: 0, unknown: 0,
  consecutiveUnfinished: 1, oldestQueuedHours: 1, lastCompletedAt: '2026-10-09T07:00:00Z', stalled: false,
}

describe('nightly-loop route — bounded wall clock (#1055 Problem A)', () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset())
    delete process.env.CRON_SECRET
    delete process.env.NIGHTLY_LOOP_BUDGET_MS
    h.listEnrolled.mockResolvedValue([enrollment(1)])
    h.recordRun.mockResolvedValue(undefined)
    h.recordRunHealth.mockResolvedValue(undefined)
    h.listRecentRuns.mockResolvedValue([])
    // Echo the real input companyId back — so a per-company result can be
    // traced to the company it came from (the shard-coverage assertions
    // depend on that being real, not a constant).
    h.runNightlyLoop.mockImplementation(async (input: any) => ({
      companyId: input.companyId, briefing: 'b', taskId: `task-${input.companyId}`,
      status: 'dispatched', detail: 'task queued for the swarm',
    }))
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
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('exposes a real, finite per-company concurrency cap (never unbounded)', () => {
    expect(NIGHTLY_COMPANY_CONCURRENCY).toBeGreaterThan(1)
    expect(NIGHTLY_COMPANY_CONCURRENCY).toBeLessThanOrEqual(16)
    expect(Number.isFinite(NIGHTLY_COMPANY_CONCURRENCY)).toBe(true)
  })

  it('runs the per-company pipeline CONCURRENTLY, capped — never 77 at once, never serial', async () => {
    h.listEnrolled.mockResolvedValue(Array.from({ length: 77 }, (_, i) => enrollment(i)))
    let active = 0
    let peak = 0
    h.runNightlyLoop.mockImplementation(async (input: any) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 3))
      active -= 1
      return { companyId: input.companyId, briefing: null, taskId: 't', status: 'dispatched', detail: 'd' }
    })

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.enrolled).toBe(77)
    expect(body.dispatched).toBe(77)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(NIGHTLY_COMPANY_CONCURRENCY)
  })

  it('77 companies at ~250ms of real per-company work finish well inside the 300s budget', async () => {
    h.listEnrolled.mockResolvedValue(Array.from({ length: 77 }, (_, i) => enrollment(i)))
    // Each mock stands in for one real network/LLM leg of the per-company
    // pipeline, at realistic latency. Serially this is 77 * ~250ms ≈ 19s of
    // simulated work; the assertion is about the SHAPE (parallel beats serial
    // by ~the concurrency factor), which is what removes the 300s exposure
    // when the real legs are seconds, not milliseconds, each.
    const leg = (ms: number) => async () => { await new Promise((r) => setTimeout(r, ms)); return undefined as any }
    h.runNightlyLoop.mockImplementation(async (input: any) => {
      await new Promise((r) => setTimeout(r, 120))
      return { companyId: input.companyId, briefing: null, taskId: 't', status: 'dispatched', detail: 'd' }
    })
    h.runNightlyCommsOutreach.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 30)); return { status: 'skipped' } })
    h.runMediaRoutines.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 40)); return { generated: 0 } })
    h.runTaskResolutions.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 40)); return { attempted: 0, completed: 0 } })
    h.pruneDuplicateReports.mockImplementation(leg(10))
    h.hasReportForDate.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 10)); return true })

    const serialEstimateMs = 77 * 250
    const t0 = Date.now()
    const res = await GET(req())
    const elapsed = Date.now() - t0

    expect(res.status).toBe(200)
    // The real win: a sweep that would take ~19s serially must now take a
    // small fraction of that. Generous bound so the assertion is about the
    // parallelization, not CI timer jitter.
    expect(elapsed).toBeLessThan(serialEstimateMs / 3)
    const body = await res.json()
    expect(body.dispatched).toBe(77)
  })

  it('stops starting new companies once the internal budget is spent, and says so honestly', async () => {
    process.env.NIGHTLY_LOOP_BUDGET_MS = '60'
    h.listEnrolled.mockResolvedValue(Array.from({ length: 40 }, (_, i) => enrollment(i)))
    h.runNightlyLoop.mockImplementation(async (input: any) => {
      await new Promise((r) => setTimeout(r, 25))
      return { companyId: input.companyId, briefing: null, taskId: 't', status: 'dispatched', detail: 'd' }
    })

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.enrolled).toBe(40)
    // Did NOT grind through all 40 — bailed when the budget ran out.
    expect(body.processed).toBeLessThan(40)
    // And reports the deferred remainder rather than silently dropping them.
    expect(body.deferred).toBe(40 - body.processed)
    expect(body.budgetExhausted).toBe(true)
  })

  it('supports sharding so the Action can split the sweep into several smaller calls', async () => {
    h.listEnrolled.mockResolvedValue(Array.from({ length: 10 }, (_, i) => enrollment(i)))
    const res = await GET(req('https://x/api/build/nightly-loop?shard=1&shards=3'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.shard).toEqual({ index: 1, count: 3 })
    // 10 companies / 3 shards → this shard handles a real subset, not all 10.
    expect(body.processed).toBeGreaterThan(0)
    expect(body.processed).toBeLessThan(10)
    // every company lands in exactly one shard
    const seen = new Set<string>()
    for (const r of body.results) seen.add(r.companyId)
    expect(seen.size).toBe(body.processed)
  })

  it('every company is covered exactly once across all shards — no company silently skipped', async () => {
    h.listEnrolled.mockResolvedValue(Array.from({ length: 77 }, (_, i) => enrollment(i)))
    const all = new Set<string>()
    for (let i = 0; i < 4; i++) {
      const res = await GET(req(`https://x/api/build/nightly-loop?shard=${i}&shards=4`))
      const body = await res.json()
      for (const r of body.results) {
        expect(all.has(r.companyId)).toBe(false) // no double-processing
        all.add(r.companyId)
      }
    }
    expect(all.size).toBe(77)
  })

  // #1130: this aggregate used to be visible only in the HTTP response and a
  // log line — neither reachable once Railway cron (not a GitHub Actions
  // matrix) calls this route directly. recordRunHealth() gives it a
  // persisted home so a silently-unhealthy shard can actually be noticed.
  it('persists this invocation\'s aggregate health, matching the HTTP response exactly', async () => {
    h.listEnrolled.mockResolvedValue(Array.from({ length: 10 }, (_, i) => enrollment(i)))
    const res = await GET(req('https://x/api/build/nightly-loop?shard=1&shards=3'))
    const body = await res.json()
    expect(h.recordRunHealth).toHaveBeenCalledTimes(1)
    expect(h.recordRunHealth).toHaveBeenCalledWith({
      shardIndex: 1, shardCount: 3,
      enrolled: 10, processed: body.processed, deferred: body.deferred,
      budgetExhausted: body.budgetExhausted, dispatched: body.dispatched,
      failed: body.failed, tasksAttempted: body.tasksAttempted,
      tasksCompleted: body.tasksCompleted,
      tasksMerged: body.tasksMerged, tasksRedeployed: body.tasksRedeployed,
      tasksReaped: body.tasksReaped,
      stalledCompanies: body.stalledCompanies,
      elapsedMs: body.elapsedMs,
    })
  })

  it('persists null shardIndex/shardCount for an unsharded (whole-list) run', async () => {
    h.listEnrolled.mockResolvedValue([enrollment(1)])
    await GET(req('https://x/api/build/nightly-loop'))
    expect(h.recordRunHealth).toHaveBeenCalledWith(
      expect.objectContaining({ shardIndex: null, shardCount: null }),
    )
  })

  it('an out-of-range or malformed shard param degrades to processing everything, not nothing', async () => {
    h.listEnrolled.mockResolvedValue(Array.from({ length: 5 }, (_, i) => enrollment(i)))
    for (const q of ['?shard=9&shards=2', '?shard=abc&shards=xyz', '?shards=0', '?shard=-1&shards=3']) {
      const body = await (await GET(req(`https://x/api/build/nightly-loop${q}`))).json()
      expect(body.processed).toBe(5)
    }
  })

  it('still caches the plan lookup per owner email even under concurrency (no duplicate core calls)', async () => {
    h.listEnrolled.mockResolvedValue([
      { ...enrollment(1), companyId: 'a' },
      { ...enrollment(1), companyId: 'b' },
      { ...enrollment(1), companyId: 'c' },
    ])
    h.fetchPlanByEmail.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10))
      return { plan: 'enterprise', email: 'founder1@x.co', verified: true }
    })
    await GET(req())
    // All three companies share one owner — exactly ONE lookup, even though
    // they now run in parallel (an in-flight-promise cache, not a value cache).
    expect(h.fetchPlanByEmail).toHaveBeenCalledTimes(1)
    expect(h.runTaskResolutions).toHaveBeenCalledTimes(3)
  })

  it("one company's hard failure never breaks the others' runs", async () => {
    h.listEnrolled.mockResolvedValue([enrollment(1), enrollment(2), enrollment(3)])
    h.runNightlyLoop.mockImplementation(async (input: any) => {
      if (input.companyId === 'co-2') throw new Error('swarm unreachable')
      return { companyId: input.companyId, briefing: null, taskId: 't', status: 'dispatched', detail: 'd' }
    })
    const body = await (await GET(req())).json()
    expect(body.dispatched).toBe(2)
    expect(body.failed).toBe(1)
  })

  it('still rejects an unauthorized caller', async () => {
    process.env.CRON_SECRET = 'sekret'
    const res = await GET(req('https://x/api/build/nightly-loop', { authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
    delete process.env.CRON_SECRET
  })
})

describe('nightly-loop route — stall visibility wiring (#1055 Problem B)', () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset())
    delete process.env.CRON_SECRET
    delete process.env.NIGHTLY_LOOP_BUDGET_MS
    h.listEnrolled.mockResolvedValue([enrollment(1)])
    h.recordRun.mockResolvedValue(undefined)
    h.recordRunHealth.mockResolvedValue(undefined)
    // Real shape of the recorded run rows the loop reads back: one row per
    // night, each carrying the task id that night's dispatch returned.
    h.listRecentRuns.mockResolvedValue([
      { companyId: 'co-1', lastTaskId: 't18', lastStatus: 'dispatched', lastRunAt: '2026-10-09T07:00:00Z' },
      { companyId: 'co-1', lastTaskId: 't17', lastStatus: 'dispatched', lastRunAt: '2026-10-08T07:00:00Z' },
    ])
    h.runNightlyLoop.mockResolvedValue({
      companyId: 'co-1', briefing: 'b', taskId: 'task-19', status: 'dispatched', detail: 'task queued for the swarm',
    })
    h.appendAutoRunEvent.mockResolvedValue(undefined)
    h.hasReportForDate.mockResolvedValue(false)
    h.createDocument.mockResolvedValue({ id: 'd1' })
    h.pruneDuplicateReports.mockResolvedValue(undefined)
    h.runMediaRoutines.mockResolvedValue({ generated: 0 })
    h.runTaskResolutions.mockResolvedValue({ attempted: 0, completed: 0 })
    h.resolveApp.mockResolvedValue(null)
    h.runNightlyCommsOutreach.mockResolvedValue({ status: 'skipped' })
    h.listTasks.mockResolvedValue([])
    h.createTask.mockResolvedValue({ id: 't1' })
    h.fetchPlanByEmail.mockResolvedValue({ plan: 'enterprise', email: 'founder1@x.co', verified: true })
    h.assessSwarmHealth.mockResolvedValue(HEALTHY_VERDICT)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it("reads back the company's recent dispatched task ids and checks their REAL status", async () => {
    h.listRecentRuns.mockResolvedValue([
      { companyId: 'co-1', lastTaskId: 't18', lastStatus: 'dispatched', lastRunAt: '2026-10-09T07:00:00Z' },
      { companyId: 'co-1', lastTaskId: 't17', lastStatus: 'dispatched', lastRunAt: '2026-10-08T07:00:00Z' },
    ])
    await GET(req())
    expect(h.listRecentRuns).toHaveBeenCalledWith('co-1', expect.any(Number))
    expect(h.assessSwarmHealth).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ taskId: 't18' })]),
    )
  })

  it("mendr's real shape: a stalled verdict makes the written report say the work has NOT completed", async () => {
    h.assessSwarmHealth.mockResolvedValue({
      checked: 6, queued: 6, running: 0, completed: 0, failed: 0, unknown: 0,
      consecutiveUnfinished: 6, oldestQueuedHours: 312,
      lastCompletedAt: '2026-09-24T07:00:00.000Z', stalled: true,
    })
    const body = await (await GET(req())).json()

    expect(h.createDocument).toHaveBeenCalledTimes(1)
    const [, doc] = h.createDocument.mock.calls[0]
    expect(doc.content).toMatch(/(has|have) NOT completed/i)
    expect(doc.content).toContain('6')
    expect(doc.title).toMatch(/needs attention|action required|stalled/i)
    // and the cron's own response surfaces the count for operator visibility
    expect(body.stalledCompanies).toBe(1)
  })

  it('a healthy company gets NO stall flag in its report and is not counted as stalled', async () => {
    const body = await (await GET(req())).json()
    const [, doc] = h.createDocument.mock.calls[0]
    expect(doc.content).not.toMatch(/(has|have) NOT completed/i)
    expect(doc.title).toBe('Daily Operational Report — ' + new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }))
    expect(body.stalledCompanies).toBe(0)
  })

  it('a swarm-health check failure never breaks the run — the report just omits the verdict', async () => {
    h.assessSwarmHealth.mockRejectedValue(new Error('core down'))
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(h.createDocument).toHaveBeenCalledTimes(1)
    const [, doc] = h.createDocument.mock.calls[0]
    expect(doc.content).not.toMatch(/(has|have) NOT completed/i)
  })

  it('a company with no prior runs at all is never assessed as stalled', async () => {
    h.listRecentRuns.mockResolvedValue([])
    h.assessSwarmHealth.mockResolvedValue({
      checked: 0, queued: 0, running: 0, completed: 0, failed: 0, unknown: 0,
      consecutiveUnfinished: 0, oldestQueuedHours: 0, lastCompletedAt: null, stalled: false,
    })
    const body = await (await GET(req())).json()
    expect(body.stalledCompanies).toBe(0)
  })
})
