import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Swarm task health / stall detection (#1055, Problem B).
 *
 * THE REAL BUG (live, confirmed on `mendr`, owner arif@8genc.com, enterprise,
 * enrolled 2026-09-13): the nightly loop dispatches a task to core's agent
 * swarm and NEVER checks back. 19 tasks were dispatched Sept 14 – Oct 10; the
 * last 6 (Sept 28 onward) are ALL still `status: queued` — zero completed work
 * for 13 days. Yet a "Daily Operational Report" landed in the founder's
 * Documents library every single night saying "Loop status: dispatched" /
 * "task queued for the swarm". Per-run honest; AGGREGATE silence.
 *
 * The swarm EXECUTOR is core's (api.ainative.studio, Celery
 * swarm_task_execution.py) — not fixable from this repo. What IS fixable here
 * is the invisibility: read back the real statuses of the recent dispatched
 * task ids and tell the founder the truth.
 */

const h = vi.hoisted(() => ({ getAinativeApiKey: vi.fn(() => 'test-key') }))
vi.mock('@/lib/build/env-keys', () => ({ getAinativeApiKey: h.getAinativeApiKey }))

import {
  summarizeSwarmTaskStates,
  assessSwarmHealth,
  STALL_SLA_HOURS,
  type SwarmTaskState,
} from '@/lib/build/swarm-task-health'

const HOUR = 60 * 60 * 1000
function hoursAgo(n: number): string {
  return new Date(Date.now() - n * HOUR).toISOString()
}

describe('summarizeSwarmTaskStates — pure stall verdict (#1055)', () => {
  it("flags mendr's REAL shape: 6 consecutive queued tasks, oldest 13 days old", () => {
    const states: SwarmTaskState[] = [
      { taskId: 't19', status: 'queued', dispatchedAt: hoursAgo(1) },
      { taskId: 't18', status: 'queued', dispatchedAt: hoursAgo(25) },
      { taskId: 't17', status: 'queued', dispatchedAt: hoursAgo(72) },
      { taskId: 't16', status: 'queued', dispatchedAt: hoursAgo(120) },
      { taskId: 't15', status: 'queued', dispatchedAt: hoursAgo(240) },
      { taskId: 't14', status: 'queued', dispatchedAt: hoursAgo(13 * 24) },
    ]
    const v = summarizeSwarmTaskStates(states)
    expect(v.stalled).toBe(true)
    expect(v.queued).toBe(6)
    expect(v.completed).toBe(0)
    expect(v.consecutiveUnfinished).toBe(6)
    // the oldest still-queued task drives the "how long has this been broken" number
    expect(v.oldestQueuedHours).toBeGreaterThanOrEqual(13 * 24 - 1)
  })

  it('does NOT false-alarm a company whose tasks are genuinely completing', () => {
    const states: SwarmTaskState[] = [
      { taskId: 't4', status: 'queued', dispatchedAt: hoursAgo(1) },
      { taskId: 't3', status: 'completed', dispatchedAt: hoursAgo(25) },
      { taskId: 't2', status: 'completed', dispatchedAt: hoursAgo(49) },
      { taskId: 't1', status: 'completed', dispatchedAt: hoursAgo(73) },
    ]
    const v = summarizeSwarmTaskStates(states)
    expect(v.stalled).toBe(false)
    expect(v.completed).toBe(3)
    // tonight's fresh dispatch being queued is normal, not a stall
    expect(v.consecutiveUnfinished).toBe(1)
  })

  it('does NOT flag a single task queued for less than the SLA — a normal fresh dispatch', () => {
    const v = summarizeSwarmTaskStates([
      { taskId: 't1', status: 'queued', dispatchedAt: hoursAgo(2) },
    ])
    expect(v.stalled).toBe(false)
    expect(v.oldestQueuedHours).toBeLessThan(STALL_SLA_HOURS)
  })

  it('flags a SINGLE task stuck queued past the SLA threshold', () => {
    const v = summarizeSwarmTaskStates([
      { taskId: 't1', status: 'queued', dispatchedAt: hoursAgo(STALL_SLA_HOURS + 2) },
    ])
    expect(v.stalled).toBe(true)
    expect(v.consecutiveUnfinished).toBe(1)
  })

  it('treats `running`/`in_progress` past the SLA as stalled too — started but never finished', () => {
    const v = summarizeSwarmTaskStates([
      { taskId: 't1', status: 'running', dispatchedAt: hoursAgo(96) },
    ])
    expect(v.stalled).toBe(true)
    expect(v.running).toBe(1)
  })

  it('a recent FAILURE is reported as failures, not silently counted as healthy progress', () => {
    const v = summarizeSwarmTaskStates([
      { taskId: 't2', status: 'failed', dispatchedAt: hoursAgo(2) },
      { taskId: 't1', status: 'failed', dispatchedAt: hoursAgo(26) },
    ])
    expect(v.failed).toBe(2)
    expect(v.completed).toBe(0)
    // failures are terminal — they are NOT a "stuck queue", so the stall flag
    // stays off; the report surfaces them via `failed` instead.
    expect(v.stalled).toBe(false)
  })

  it('an UNKNOWN status (status lookup failed) is never treated as success or as a stall', () => {
    const v = summarizeSwarmTaskStates([
      { taskId: 't1', status: 'unknown', dispatchedAt: hoursAgo(200) },
    ])
    expect(v.stalled).toBe(false)
    expect(v.completed).toBe(0)
    expect(v.unknown).toBe(1)
  })

  it('no dispatched tasks at all is honestly "nothing to assess", never a stall', () => {
    const v = summarizeSwarmTaskStates([])
    expect(v.stalled).toBe(false)
    expect(v.checked).toBe(0)
  })

  it('reports the real last-completed timestamp so the report can say "no completed work since X"', () => {
    const at = hoursAgo(13 * 24)
    const v = summarizeSwarmTaskStates([
      { taskId: 't2', status: 'queued', dispatchedAt: hoursAgo(1) },
      { taskId: 't1', status: 'completed', dispatchedAt: at },
    ])
    expect(v.lastCompletedAt).toBe(at)
  })
})

describe('assessSwarmHealth — real network read of core task status (#1055)', () => {
  const realFetch = global.fetch
  beforeEach(() => {
    h.getAinativeApiKey.mockReturnValue('test-key')
    process.env.AINATIVE_API_URL = 'https://api.test.local'
  })
  afterEach(() => {
    global.fetch = realFetch
    vi.restoreAllMocks()
    delete process.env.AINATIVE_API_URL
  })

  it("polls core's own task-status endpoint per task id and builds the verdict from REAL statuses", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({ task_id: String(url).split('/').pop(), status: 'queued' }),
    }))
    global.fetch = fetchMock as any

    const verdict = await assessSwarmHealth([
      { taskId: 'a', dispatchedAt: hoursAgo(26) },
      { taskId: 'b', dispatchedAt: hoursAgo(50) },
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(calledUrls[0]).toBe('https://api.test.local/api/v1/public/agent-swarm/tasks/a')
    expect(verdict.stalled).toBe(true)
    expect(verdict.queued).toBe(2)
  })

  it('a non-OK status lookup degrades to `unknown` — never invents completed or stalled', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' })) as any
    const verdict = await assessSwarmHealth([{ taskId: 'a', dispatchedAt: hoursAgo(200) }])
    expect(verdict.unknown).toBe(1)
    expect(verdict.stalled).toBe(false)
  })

  it('a thrown fetch degrades to `unknown` and never escapes to break the nightly loop', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network down') }) as any
    const verdict = await assessSwarmHealth([{ taskId: 'a', dispatchedAt: hoursAgo(200) }])
    expect(verdict.unknown).toBe(1)
    expect(verdict.stalled).toBe(false)
  })

  it('does nothing (and makes no network call) with no API key configured', async () => {
    h.getAinativeApiKey.mockReturnValue('')
    const fetchMock = vi.fn()
    global.fetch = fetchMock as any
    const verdict = await assessSwarmHealth([{ taskId: 'a', dispatchedAt: hoursAgo(200) }])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(verdict.checked).toBe(0)
  })

  it('caps how many task ids it checks so one company cannot starve the shared cron budget', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ status: 'queued' }) }))
    global.fetch = fetchMock as any
    const many = Array.from({ length: 40 }, (_, i) => ({ taskId: `t${i}`, dispatchedAt: hoursAgo(i + 30) }))
    await assessSwarmHealth(many)
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(10)
  })
})
