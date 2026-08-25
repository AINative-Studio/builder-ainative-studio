import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  AUTO_DURATIONS,
  DURATION_LABELS,
  DURATION_HOURS,
  DISPATCH_INTERVAL_MINUTES,
  CREDITS_PER_DISPATCH,
  isAutoDuration,
  normalizeDuration,
  plannedDispatches,
  estimateCreditCost,
  creditCostLabel,
  computeExpiry,
  runProgress,
  formatTimeLeft,
  latestAutoRun,
  autoModeConfigured,
  startAutoRun,
  stopAutoRun,
  getAutoRun,
  type AutoRun,
} from '@/lib/build/auto-mode'

/**
 * #58 — Auto Mode duration + bounded-run logic. Covers the pure core (duration
 * catalog, normalization, planned dispatches, credit cost, expiry, live progress,
 * time formatting, latest-run selection) and the ZeroDB-backed run store
 * (start/stop/get) by stubbing global.fetch — same strategy as the task-store /
 * chat-store tests. The vitest env is 'node'; no network is ever touched.
 */

const T0 = Date.parse('2026-08-25T00:00:00.000Z')

// ---------- duration catalog ----------
describe('duration catalog (#58)', () => {
  it('exposes exactly the five Polsia-style durations', () => {
    expect([...AUTO_DURATIONS]).toEqual(['1h', '4h', '8h', 'overnight', 'continuous'])
  })
  it('has a human label + hours mapping for each', () => {
    for (const d of AUTO_DURATIONS) {
      expect(typeof DURATION_LABELS[d]).toBe('string')
      expect(d in DURATION_HOURS).toBe(true)
    }
    expect(DURATION_HOURS['1h']).toBe(1)
    expect(DURATION_HOURS.overnight).toBe(8)
    expect(DURATION_HOURS.continuous).toBeNull()
  })
})

// ---------- isAutoDuration / normalizeDuration ----------
describe('isAutoDuration (#58)', () => {
  it('accepts the five canonical durations', () => {
    for (const d of AUTO_DURATIONS) expect(isAutoDuration(d)).toBe(true)
  })
  it('rejects anything else', () => {
    expect(isAutoDuration('2h')).toBe(false)
    expect(isAutoDuration('')).toBe(false)
    expect(isAutoDuration(null)).toBe(false)
    expect(isAutoDuration(4)).toBe(false)
  })
})

describe('normalizeDuration (#58)', () => {
  it('passes through canonical durations', () => {
    for (const d of AUTO_DURATIONS) expect(normalizeDuration(d)).toBe(d)
  })
  it('maps loose aliases', () => {
    expect(normalizeDuration('60m')).toBe('1h')
    expect(normalizeDuration('hour')).toBe('1h')
    expect(normalizeDuration('4hr')).toBe('4h')
    expect(normalizeDuration('480m')).toBe('8h')
    expect(normalizeDuration('night')).toBe('overnight')
    expect(normalizeDuration('nonstop')).toBe('continuous')
    expect(normalizeDuration('forever')).toBe('continuous')
  })
  it('defaults unknown input to 1h', () => {
    expect(normalizeDuration('banana')).toBe('1h')
    expect(normalizeDuration(undefined)).toBe('1h')
    expect(normalizeDuration(null)).toBe('1h')
  })
})

// ---------- plannedDispatches ----------
describe('plannedDispatches (#58)', () => {
  it('is one per interval that starts inside the half-open window', () => {
    // 30m cadence, [start,end): 1h → [0,30),[30,60) = 2; 4h → 8; 8h → 16
    expect(plannedDispatches('1h')).toBe(2)
    expect(plannedDispatches('4h')).toBe(8)
    expect(plannedDispatches('8h')).toBe(16)
    expect(plannedDispatches('overnight')).toBe(16)
  })
  it('is null (unbounded) for continuous', () => {
    expect(plannedDispatches('continuous')).toBeNull()
  })
  it('respects the interval constant', () => {
    expect(DISPATCH_INTERVAL_MINUTES).toBe(30)
  })
})

// ---------- credit cost ----------
describe('credit cost (#58)', () => {
  it('quotes a bounded total = dispatches × per-dispatch', () => {
    expect(estimateCreditCost('1h').total).toBe(2 * CREDITS_PER_DISPATCH)
    expect(estimateCreditCost('4h').total).toBe(8 * CREDITS_PER_DISPATCH)
  })
  it('quotes continuous per-hour with no total', () => {
    const c = estimateCreditCost('continuous')
    expect(c.total).toBeNull()
    expect(c.perHour).toBe(2 * CREDITS_PER_DISPATCH) // 2 dispatches/hour × 10
  })
  it('renders a human cost label', () => {
    expect(creditCostLabel('1h')).toBe(`≈ ${2 * CREDITS_PER_DISPATCH} credits`)
    expect(creditCostLabel('continuous')).toBe(`≈ ${2 * CREDITS_PER_DISPATCH} credits/hour`)
  })
})

// ---------- computeExpiry ----------
describe('computeExpiry (#58)', () => {
  it('is startedAt + hours for a bounded window', () => {
    expect(computeExpiry('1h', T0)).toBe(new Date(T0 + 3.6e6).toISOString())
    expect(computeExpiry('8h', T0)).toBe(new Date(T0 + 8 * 3.6e6).toISOString())
  })
  it('is null for continuous', () => {
    expect(computeExpiry('continuous', T0)).toBeNull()
  })
})

// ---------- runProgress ----------
describe('runProgress (#58)', () => {
  it('is idle/off for a null run', () => {
    const p = runProgress(null, T0)
    expect(p.running).toBe(false)
    expect(p.timeLeftLabel).toBe('off')
    expect(p.dispatchesSoFar).toBe(0)
  })
  it('reports running + a countdown mid-window', () => {
    const run = { duration: '4h' as const, startedAt: new Date(T0).toISOString(), expiresAt: computeExpiry('4h', T0) }
    const p = runProgress(run, T0 + 60 * 60 * 1000) // 1h in
    expect(p.running).toBe(true)
    expect(p.minutesRemaining).toBe(180)
    expect(p.timeLeftLabel).toBe('3h')
    // 1h elapsed at 30m cadence → dispatches at 0m,30m,60m = 3
    expect(p.dispatchesSoFar).toBe(3)
  })
  it('clamps dispatchesSoFar to the planned total for a bounded run', () => {
    const run = { duration: '1h' as const, startedAt: new Date(T0).toISOString(), expiresAt: computeExpiry('1h', T0) }
    // Way past expiry — should be expired + clamped to 2, not unbounded.
    const p = runProgress(run, T0 + 10 * 60 * 60 * 1000)
    expect(p.running).toBe(false)
    expect(p.timeLeftLabel).toBe('ended')
    expect(p.dispatchesSoFar).toBe(2)
  })
  it('treats a past-expiry run as ended', () => {
    const run = { duration: '1h' as const, startedAt: new Date(T0).toISOString(), expiresAt: computeExpiry('1h', T0) }
    const p = runProgress(run, T0 + 61 * 60 * 1000)
    expect(p.running).toBe(false)
    expect(p.msRemaining).toBeNull()
  })
  it('treats a stopped run as stopped regardless of expiry', () => {
    const run = {
      duration: '8h' as const,
      startedAt: new Date(T0).toISOString(),
      expiresAt: computeExpiry('8h', T0),
      stoppedAt: new Date(T0 + 30 * 60 * 1000).toISOString(),
    }
    const p = runProgress(run, T0 + 60 * 60 * 1000)
    expect(p.running).toBe(false)
    expect(p.timeLeftLabel).toBe('stopped')
  })
  it('runs continuously with no countdown for a continuous run', () => {
    const run = { duration: 'continuous' as const, startedAt: new Date(T0).toISOString(), expiresAt: null }
    const p = runProgress(run, T0 + 5 * 60 * 60 * 1000)
    expect(p.running).toBe(true)
    expect(p.msRemaining).toBeNull()
    expect(p.timeLeftLabel).toBe('running')
    expect(p.dispatchesSoFar).toBeGreaterThan(1)
  })
  it('ignores an invalid startedAt', () => {
    const run = { duration: '1h' as const, startedAt: 'not-a-date', expiresAt: null }
    expect(runProgress(run, T0).running).toBe(false)
  })
})

// ---------- formatTimeLeft ----------
describe('formatTimeLeft (#58)', () => {
  it('formats h/m combinations', () => {
    expect(formatTimeLeft(2 * 3.6e6 + 5 * 60000)).toBe('2h 5m')
    expect(formatTimeLeft(45 * 60000)).toBe('45m')
    expect(formatTimeLeft(3 * 3.6e6)).toBe('3h')
  })
  it('handles sub-minute + zero', () => {
    expect(formatTimeLeft(30_000)).toBe('under a minute')
    expect(formatTimeLeft(0)).toBe('ended')
    expect(formatTimeLeft(-1)).toBe('ended')
  })
})

// ---------- latestAutoRun ----------
describe('latestAutoRun (#58)', () => {
  const mk = (over: Partial<AutoRun>): AutoRun => ({
    kind: 'auto', companyId: 'acme', duration: '1h',
    startedAt: new Date(T0).toISOString(), expiresAt: computeExpiry('1h', T0),
    ...over,
  })
  it('returns null when no rows match the company', () => {
    expect(latestAutoRun([mk({ companyId: 'other' })], 'acme')).toBeNull()
    expect(latestAutoRun([], 'acme')).toBeNull()
  })
  it('picks the newest by effective timestamp, stop superseding its start', () => {
    const start = mk({ startedAt: new Date(T0).toISOString() })
    const stop = mk({ startedAt: new Date(T0).toISOString(), stoppedAt: new Date(T0 + 60000).toISOString() })
    expect(latestAutoRun([start, stop], 'acme')?.stoppedAt).toBe(stop.stoppedAt)
    // order independent
    expect(latestAutoRun([stop, start], 'acme')?.stoppedAt).toBe(stop.stoppedAt)
  })
  it('ignores non-auto rows', () => {
    const other = { kind: 'run', companyId: 'acme' } as unknown as AutoRun
    expect(latestAutoRun([other], 'acme')).toBeNull()
  })
})

// ---------- ZeroDB-backed store (mocked fetch) ----------
describe('run store I/O (#58)', () => {
  const OLD_ENV = { ...process.env }
  beforeEach(() => {
    process.env.AINATIVE_API_KEY = 'test-key'
    process.env.ZERODB_PROJECT_ID = 'proj-1'
    vi.restoreAllMocks()
  })
  afterEach(() => {
    process.env = { ...OLD_ENV }
    vi.restoreAllMocks()
  })

  it('autoModeConfigured reflects key + project presence', () => {
    expect(autoModeConfigured()).toBe(true)
  })

  it('startAutoRun POSTs a start row and returns the run', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const run = await startAutoRun({ companyId: 'acme', companyName: 'Acme', duration: '4h', nowMs: T0 })
    expect(run).not.toBeNull()
    expect(run?.duration).toBe('4h')
    expect(run?.expiresAt).toBe(computeExpiry('4h', T0))
    expect(run?.stoppedAt).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.row_data.kind).toBe('auto')
    expect(body.row_data.companyId).toBe('acme')
  })

  it('startAutoRun returns null when the write fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response))
    expect(await startAutoRun({ companyId: 'acme', duration: '1h', nowMs: T0 })).toBeNull()
  })

  it('startAutoRun returns null (inert) when unconfigured', async () => {
    delete process.env.AINATIVE_API_KEY
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await startAutoRun({ companyId: 'acme', duration: '1h' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('getAutoRun returns the latest auto row for the company', async () => {
    const rows = {
      data: [
        { row_data: { kind: 'auto', companyId: 'acme', duration: '1h', startedAt: new Date(T0).toISOString(), expiresAt: computeExpiry('1h', T0) } },
        { row_data: { kind: 'auto', companyId: 'acme', duration: '8h', startedAt: new Date(T0 + 5000).toISOString(), expiresAt: computeExpiry('8h', T0 + 5000) } },
        { row_data: { kind: 'run', companyId: 'acme' } },
        { row_data: { kind: 'auto', companyId: 'other', duration: '4h', startedAt: new Date(T0 + 9999).toISOString(), expiresAt: null } },
      ],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(rows) } as Response))
    const run = await getAutoRun('acme')
    expect(run?.duration).toBe('8h') // newest acme auto row wins; 'other' + 'run' excluded
  })

  it('getAutoRun returns null on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: async () => '' } as Response))
    expect(await getAutoRun('acme')).toBeNull()
  })

  it('stopAutoRun appends a stopped row carrying the current run fields', async () => {
    const current = {
      data: [{ row_data: { kind: 'auto', companyId: 'acme', companyName: 'Acme', duration: '8h', startedAt: new Date(T0).toISOString(), expiresAt: computeExpiry('8h', T0) } }],
    }
    const fetchMock = vi.fn()
      // 1st call = getAutoRun list, 2nd = the stop POST
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify(current) } as Response)
      .mockResolvedValueOnce({ ok: true, text: async () => '{}' } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const ok = await stopAutoRun({ companyId: 'acme', nowMs: T0 + 60000 })
    expect(ok).toBe(true)
    const stopBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)
    expect(stopBody.row_data.stoppedAt).toBe(new Date(T0 + 60000).toISOString())
    expect(stopBody.row_data.duration).toBe('8h')
    expect(stopBody.row_data.startedAt).toBe(new Date(T0).toISOString())
  })

  it('stopAutoRun is inert (false) when unconfigured', async () => {
    delete process.env.AINATIVE_API_KEY
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await stopAutoRun({ companyId: 'acme' })).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('store calls swallow network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    expect(await startAutoRun({ companyId: 'acme', duration: '1h' })).toBeNull()
    expect(await getAutoRun('acme')).toBeNull()
  })
})
