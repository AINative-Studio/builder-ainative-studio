import { describe, it, expect } from 'vitest'

/**
 * #340 — Auto Mode run activity, pure core.
 *   - appendRecentEvent: ring buffer (last 12), immutable, drops malformed.
 *   - dispatchEventTitle: honest title from the REAL dispatch, no agent names.
 *   - activityRows / activityState: event → swarm-card row mapping + honest
 *     empty state selection (real pipeline stages).
 *   - ribbonLine: per-company masthead line in Cody's voice.
 *   - latestAutoRun: an event-append row (updatedAt) supersedes its start row.
 */

import {
  MAX_RECENT_EVENTS,
  ACTIVITY_EMPTY_LINE,
  isAutoRunEvent,
  appendRecentEvent,
  dispatchEventTitle,
  activityRows,
  activityState,
  ribbonLine,
  type AutoRunEvent,
} from '@/lib/build/auto-run-activity'
import { latestAutoRun, type AutoRun } from '@/lib/build/auto-mode'

const ev = (i: number, status: AutoRunEvent['status'] = 'dispatched'): AutoRunEvent => ({
  ts: new Date(1700000000000 + i * 60000).toISOString(),
  title: `task ${i}`,
  status,
})

describe('isAutoRunEvent (#340)', () => {
  it('accepts a well-formed event', () => {
    expect(isAutoRunEvent(ev(1))).toBe(true)
    expect(isAutoRunEvent(ev(2, 'shipped'))).toBe(true)
    expect(isAutoRunEvent(ev(3, 'failed'))).toBe(true)
  })

  it('rejects malformed values', () => {
    expect(isAutoRunEvent(null)).toBe(false)
    expect(isAutoRunEvent('dispatched')).toBe(false)
    expect(isAutoRunEvent({ ts: 1, title: 'x', status: 'dispatched' })).toBe(false)
    expect(isAutoRunEvent({ ts: 'now', title: 'x', status: 'exploded' })).toBe(false)
    expect(isAutoRunEvent({ ts: 'now', status: 'shipped' })).toBe(false)
  })
})

describe('appendRecentEvent ring buffer (#340)', () => {
  it('appends to an empty / missing trail', () => {
    expect(appendRecentEvent(undefined, ev(1))).toEqual([ev(1)])
    expect(appendRecentEvent(null, ev(1))).toEqual([ev(1)])
    expect(appendRecentEvent([], ev(1))).toEqual([ev(1)])
  })

  it('keeps append order — newest last', () => {
    const trail = appendRecentEvent([ev(1)], ev(2))
    expect(trail.map((e) => e.title)).toEqual(['task 1', 'task 2'])
  })

  it('caps at MAX_RECENT_EVENTS (12), dropping the OLDEST', () => {
    let trail: AutoRunEvent[] = []
    for (let i = 1; i <= 15; i++) trail = appendRecentEvent(trail, ev(i))
    expect(MAX_RECENT_EVENTS).toBe(12)
    expect(trail).toHaveLength(12)
    expect(trail[0].title).toBe('task 4') // 1..3 rolled off
    expect(trail[11].title).toBe('task 15')
  })

  it('never mutates the input array', () => {
    const prior = [ev(1)]
    appendRecentEvent(prior, ev(2))
    expect(prior).toHaveLength(1)
  })

  it('drops malformed prior entries read back from the store', () => {
    const dirty = [ev(1), { junk: true }, 'nope', null] as unknown[]
    const trail = appendRecentEvent(dirty, ev(2))
    expect(trail).toEqual([ev(1), ev(2)])
  })
})

describe('dispatchEventTitle (#340)', () => {
  it('names the company-track dispatch a growth task', () => {
    expect(dispatchEventTitle({ track: 'company', taskId: 'abcdef1234567890' }))
      .toBe('highest-leverage growth task · task abcdef12')
  })

  it('names the app-track dispatch a product task', () => {
    expect(dispatchEventTitle({ track: 'app', taskId: 'ffff0000' }))
      .toBe('highest-leverage product task · task ffff0000')
  })

  it('omits the task fragment when there is no task id (failed dispatch)', () => {
    expect(dispatchEventTitle({ track: 'company', taskId: null }))
      .toBe('highest-leverage growth task')
  })
})

describe('activityRows (#340)', () => {
  it('maps statuses to the swarm grammar glyphs + tones', () => {
    const rows = activityRows([ev(1, 'dispatched'), ev(2, 'shipped'), ev(3, 'failed')])
    // Newest first.
    expect(rows.map((r) => r.status)).toEqual(['failed', 'shipped', 'dispatched'])
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r]))
    expect(byStatus.dispatched).toMatchObject({ glyph: '●', tone: 'is-working', st: 'is-running' })
    expect(byStatus.shipped).toMatchObject({ glyph: '✓', tone: 'is-done', st: 'is-done' })
    expect(byStatus.failed).toMatchObject({ glyph: '·', tone: 'is-idle', st: 'is-planned' })
  })

  it('caps at the row limit (default 6), newest first', () => {
    const trail = Array.from({ length: 10 }, (_, i) => ev(i + 1))
    const rows = activityRows(trail)
    expect(rows).toHaveLength(6)
    expect(rows[0].title).toBe('task 10')
    expect(rows[5].title).toBe('task 5')
  })

  it('drops malformed entries and tolerates null', () => {
    expect(activityRows(null)).toEqual([])
    expect(activityRows([{ bad: 1 }, ev(1)])).toHaveLength(1)
  })
})

describe('activityState — honest empty-state selection (#340)', () => {
  it('hidden when no run is active (even with stale events)', () => {
    expect(activityState(false, [ev(1)]).mode).toBe('hidden')
  })

  it('empty (real pipeline stages) while active but no events yet', () => {
    const s = activityState(true, [])
    expect(s.mode).toBe('empty')
    expect(s.rows).toEqual([])
    expect(ACTIVITY_EMPTY_LINE).toBe('briefing → picking the highest-leverage task')
  })

  it('rows once events land', () => {
    const s = activityState(true, [ev(1)])
    expect(s.mode).toBe('rows')
    expect(s.rows).toHaveLength(1)
  })
})

describe('ribbonLine — per-company masthead line (#340)', () => {
  it('null when no run is active — the platform proof ticker stands alone', () => {
    expect(ribbonLine(false, [ev(1)], 'Fount')).toBeNull()
  })

  it('warm-up line while active with no events', () => {
    expect(ribbonLine(true, [], 'Fount'))
      .toBe(`auto mode · Fount — ${ACTIVITY_EMPTY_LINE}`)
  })

  it("narrates the LATEST event in Cody's first person", () => {
    expect(ribbonLine(true, [ev(1), ev(2)], 'Fount'))
      .toBe('auto mode · Fount — I dispatched task 2')
    expect(ribbonLine(true, [ev(1), ev(2, 'shipped')], 'Fount'))
      .toBe('auto mode · Fount — I shipped task 2')
    expect(ribbonLine(true, [ev(2, 'failed')], 'Fount'))
      .toBe('auto mode · Fount — a dispatch failed — task 2')
  })
})

describe('latestAutoRun × event-append rows (#340)', () => {
  const base: AutoRun = {
    kind: 'auto',
    companyId: 'fount',
    duration: '4h',
    startedAt: '2026-08-27T01:00:00.000Z',
    expiresAt: '2026-08-27T05:00:00.000Z',
    stoppedAt: null,
  }

  it('an event-append row (updatedAt) supersedes its own start row', () => {
    const appended: AutoRun = {
      ...base,
      updatedAt: '2026-08-27T01:05:00.000Z',
      recentEvents: [ev(1)],
    }
    const latest = latestAutoRun([base, appended], 'fount')
    expect(latest?.recentEvents).toHaveLength(1)
  })

  it('a stop row still supersedes event-append rows', () => {
    const appended: AutoRun = { ...base, updatedAt: '2026-08-27T01:05:00.000Z', recentEvents: [ev(1)] }
    const stop: AutoRun = { ...base, stoppedAt: '2026-08-27T02:00:00.000Z', recentEvents: [ev(1)] }
    const latest = latestAutoRun([appended, stop, base], 'fount')
    expect(latest?.stoppedAt).toBe('2026-08-27T02:00:00.000Z')
  })
})
