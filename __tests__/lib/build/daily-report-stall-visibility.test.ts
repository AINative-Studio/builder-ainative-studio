import { describe, it, expect } from 'vitest'
import { buildDailyReport, dailyReportTitle } from '@/lib/build/document-prompts'
import type { SwarmHealthVerdict } from '@/lib/build/swarm-task-health'

/**
 * Daily Operational Report must tell the AGGREGATE truth (#1055, Problem B).
 *
 * THE REAL BUG: mendr's founder received a report every night for 13 straight
 * days whose Executive Summary said Cody "dispatched the highest-leverage task
 * to the AINative agent swarm" and whose Key Findings said "Loop status:
 * dispatched" — while all 6 of those nights' tasks sat in core's queue at
 * `status: queued` and ZERO completed. Per-run honest, aggregate misleading.
 *
 * The report is pure + deterministic (no model call), so this is directly
 * testable: given a real stall verdict, it must lead with the stall.
 */

const BASE = {
  companyName: 'mendr',
  runAt: '2026-10-10T07:00:00.000Z',
  taskId: 'task-19',
  status: 'dispatched',
  briefing: 'repair-trade ops briefing',
  detail: 'task queued for the swarm',
}

const STALLED: SwarmHealthVerdict = {
  checked: 6, queued: 6, running: 0, completed: 0, failed: 0, unknown: 0,
  consecutiveUnfinished: 6, oldestQueuedHours: 312, lastCompletedAt: '2026-09-24T07:00:00.000Z',
  stalled: true,
}

const HEALTHY: SwarmHealthVerdict = {
  checked: 4, queued: 1, running: 0, completed: 3, failed: 0, unknown: 0,
  consecutiveUnfinished: 1, oldestQueuedHours: 2, lastCompletedAt: '2026-10-09T07:00:00.000Z',
  stalled: false,
}

describe('buildDailyReport — stall visibility (#1055)', () => {
  it('today (unchanged behaviour): a healthy dispatch with no verdict still reads as a normal dispatch', () => {
    const md = buildDailyReport(BASE)
    expect(md).toContain('## Executive Summary')
    expect(md).toContain('dispatched the highest-leverage task')
    expect(md).not.toMatch(/not completed|stalled/i)
  })

  it('a STALLED verdict leads the Executive Summary with the honest aggregate, not "dispatched"', () => {
    const md = buildDailyReport({ ...BASE, swarmHealth: STALLED })
    const summary = md.split('## Key Findings')[0]
    // The founder-facing headline must say the work is NOT completing.
    expect(summary).toMatch(/not completed|has not completed/i)
    expect(summary).toContain('6')
    // and it must NOT open by implying everything is fine
    expect(summary).not.toMatch(/^## Executive Summary\nOvernight, Cody evaluated mendr and dispatched/m)
  })

  it('names the real number of consecutive unfinished nights and how long it has been stuck', () => {
    const md = buildDailyReport({ ...BASE, swarmHealth: STALLED })
    expect(md).toContain('6')
    expect(md).toMatch(/13 days|312 hours|13\s*day/i)
  })

  it('names the real last-completed date so the founder can see when work actually stopped', () => {
    const md = buildDailyReport({ ...BASE, swarmHealth: STALLED })
    expect(md).toMatch(/Sep 24, 2026/)
  })

  it('tells the founder what to do about it instead of "poll the dispatched task"', () => {
    const md = buildDailyReport({ ...BASE, swarmHealth: STALLED })
    const next = md.split('### Next actions')[1] || ''
    expect(next).toMatch(/support|escalat|investigat/i)
  })

  it('a HEALTHY verdict produces NO false alarm — the report reads as a normal dispatch', () => {
    const md = buildDailyReport({ ...BASE, swarmHealth: HEALTHY })
    const summary = md.split('## Key Findings')[0]
    expect(summary).toContain('dispatched the highest-leverage task')
    expect(summary).not.toMatch(/not completed|stalled/i)
    // but it still honestly reports the real completed count as a finding
    expect(md).toMatch(/3 .*completed|completed.*3/i)
  })

  it('a healthy verdict with zero checked tasks (brand-new enrollment) never claims a stall', () => {
    const md = buildDailyReport({
      ...BASE,
      swarmHealth: { checked: 0, queued: 0, running: 0, completed: 0, failed: 0, unknown: 0, consecutiveUnfinished: 0, oldestQueuedHours: 0, lastCompletedAt: null, stalled: false },
    })
    expect(md).not.toMatch(/not completed|stalled/i)
  })

  it('the TITLE flags a stall so the founder sees it in the Documents list without opening the doc', () => {
    expect(dailyReportTitle(BASE)).toBe('Daily Operational Report — Oct 10, 2026')
    expect(dailyReportTitle({ ...BASE, swarmHealth: STALLED })).toMatch(/Oct 10, 2026/)
    expect(dailyReportTitle({ ...BASE, swarmHealth: STALLED })).toMatch(/needs attention|stalled|action required/i)
    // a healthy run's title is unchanged — no alarm creep
    expect(dailyReportTitle({ ...BASE, swarmHealth: HEALTHY })).toBe('Daily Operational Report — Oct 10, 2026')
  })

  it('an all-unknown verdict (core status endpoint unreachable) does not claim a stall OR fabricate progress', () => {
    const md = buildDailyReport({
      ...BASE,
      swarmHealth: { checked: 3, queued: 0, running: 0, completed: 0, failed: 0, unknown: 3, consecutiveUnfinished: 0, oldestQueuedHours: 0, lastCompletedAt: null, stalled: false },
    })
    expect(md).not.toMatch(/(has|have) NOT completed/i)
    expect(md).toMatch(/could not be (read|verified)|unknown/i)
  })
})
