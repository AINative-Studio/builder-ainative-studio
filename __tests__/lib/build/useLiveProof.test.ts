// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useLiveProof } from '@/lib/build/useLiveProof'

/**
 * Tests for lib/build/useLiveProof.ts — live-proof (platform-intelligence) hook.
 *
 * Environment: jsdom (required for hooks/useEffect).
 * All fetch calls are mocked — zero API budget.
 * We use vi.useFakeTimers with advanceTimersByTimeAsync to avoid the infinite
 * setInterval loop that vi.runAllTimers triggers.
 */

function makeJsonResponse(stats: Record<string, unknown>, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve({ stats }),
  } as Response)
}

describe('useLiveProof — initial state', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns all-null proof before fetch resolves', () => {
    // Never resolves — stays pending
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { result } = renderHook(() => useLiveProof())
    expect(result.current.agentsActive).toBeNull()
    expect(result.current.tasksToday).toBeNull()
    expect(result.current.apiRequestsToday).toBeNull()
    expect(result.current.companiesBuilt).toBeNull()
  })
})

describe('useLiveProof — successful fetch', () => {
  afterEach(() => vi.restoreAllMocks())

  it('populates all proof fields from the stats object', async () => {
    vi.stubGlobal('fetch', vi.fn(() => makeJsonResponse({
      agents_active: 42,
      tasks_completed_24h: 1200,
      api_requests_today: '99K',
      total_companies: 500,
    })))
    const { result } = renderHook(() => useLiveProof())
    await waitFor(() => expect(result.current.agentsActive).toBe(42), { timeout: 3000 })
    expect(result.current.tasksToday).toBe(1200)
    expect(result.current.apiRequestsToday).toBe('99K')
    expect(result.current.companiesBuilt).toBe(500)
  })

  it('falls back to tasks_completed_today when tasks_completed_24h absent', async () => {
    vi.stubGlobal('fetch', vi.fn(() => makeJsonResponse({
      agents_active: 5,
      tasks_completed_today: 50,
      total_companies: 10,
    })))
    const { result } = renderHook(() => useLiveProof())
    await waitFor(() => expect(result.current.tasksToday).toBe(50), { timeout: 3000 })
  })

  it('falls back to companies (singular) when total_companies absent', async () => {
    vi.stubGlobal('fetch', vi.fn(() => makeJsonResponse({
      agents_active: 2,
      companies: 77,
    })))
    const { result } = renderHook(() => useLiveProof())
    await waitFor(() => expect(result.current.companiesBuilt).toBe(77), { timeout: 3000 })
  })

  it('rounds fractional numbers', async () => {
    vi.stubGlobal('fetch', vi.fn(() => makeJsonResponse({
      agents_active: 3.7,
      total_companies: 12.1,
    })))
    const { result } = renderHook(() => useLiveProof())
    await waitFor(() => expect(result.current.agentsActive).toBe(4), { timeout: 3000 })
    expect(result.current.companiesBuilt).toBe(12)
  })

  it('parses string-encoded numbers', async () => {
    vi.stubGlobal('fetch', vi.fn(() => makeJsonResponse({
      agents_active: '15',
      total_companies: '300',
    })))
    const { result } = renderHook(() => useLiveProof())
    await waitFor(() => expect(result.current.agentsActive).toBe(15), { timeout: 3000 })
    expect(result.current.companiesBuilt).toBe(300)
  })

  it('leaves agentsActive null when value is non-numeric', async () => {
    vi.stubGlobal('fetch', vi.fn(() => makeJsonResponse({
      agents_active: 'not-a-number',
      total_companies: null,
    })))
    const { result } = renderHook(() => useLiveProof())
    // Hook fires; we wait for the effect to run, then check nullity
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    // After a non-numeric value, fields should stay null
    expect(result.current.agentsActive).toBeNull()
    expect(result.current.companiesBuilt).toBeNull()
  })
})

describe('useLiveProof — failure handling', () => {
  afterEach(() => vi.restoreAllMocks())

  it('leaves proof null on network error (fetch rejects)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Network fail'))))
    const { result } = renderHook(() => useLiveProof())
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(result.current.agentsActive).toBeNull()
    expect(result.current.companiesBuilt).toBeNull()
  })

  it('leaves proof null when fetch returns non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) } as Response)))
    const { result } = renderHook(() => useLiveProof())
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(result.current.agentsActive).toBeNull()
  })

  it('leaves proof null when stats object is missing from response', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ other_field: 'ignored' }),
    } as Response)))
    const { result } = renderHook(() => useLiveProof())
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(result.current.agentsActive).toBeNull()
  })

  it('leaves proof null when json() rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.reject(new Error('bad json')),
    } as Response)))
    const { result } = renderHook(() => useLiveProof())
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(result.current.agentsActive).toBeNull()
  })
})

describe('useLiveProof — interval refresh', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: false }))
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('polls again after 15 seconds', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => makeJsonResponse({ agents_active: 1, total_companies: 10 }))
      .mockImplementationOnce(() => makeJsonResponse({ agents_active: 2, total_companies: 20 }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useLiveProof())
    // Drain the initial fetch microtasks
    await act(async () => { await vi.runAllTicks() })
    await act(async () => { await Promise.resolve() })

    // Advance 15 seconds to trigger the interval
    await act(async () => { vi.advanceTimersByTime(15_000) })
    await act(async () => { await vi.runAllTicks() })
    await act(async () => { await Promise.resolve() })

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

describe('useLiveProof — cleanup on unmount', () => {
  afterEach(() => vi.restoreAllMocks())

  it('does not throw when unmounted before fetch resolves', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) // never resolves
    const { unmount } = renderHook(() => useLiveProof())
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    // Should not throw
    expect(() => unmount()).not.toThrow()
  })
})
