import { describe, it, expect, vi, afterEach } from 'vitest'
import { countVisitors } from '@/lib/build/visitor-metrics'

/**
 * #483/#563 — the real read side behind the Live dashboard's "visitors" hero
 * metric. Counts real rows in a company's OWN ZeroDB project (never a shared
 * pool), written by the mandated /api/db/visitors beacon every generated
 * landing page fires on mount.
 */

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('countVisitors', () => {
  it('returns 0 without a projectId — never calls fetch, honest empty state for an unprovisioned company', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await countVisitors(undefined)).toBe(0)
    expect(await countVisitors(null)).toBe(0)
    expect(await countVisitors('')).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the real total from a live rows-list response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ total: 42, data: [] }) }))
    expect(await countVisitors('proj-1')).toBe(42)
  })

  it('returns 0 for a never-visited app (real total: 0), never fabricated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ total: 0, data: [] }) }))
    expect(await countVisitors('proj-1')).toBe(0)
  })

  it('returns 0 on a non-ok response (e.g. table not found yet) — never throws, never fabricates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    expect(await countVisitors('proj-1')).toBe(0)
  })

  it('returns 0 (never throws) on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
    expect(await countVisitors('proj-1')).toBe(0)
  })

  it('falls back to counting returned rows when total is absent from the response shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: '1' }, { id: '2' }] }) }))
    expect(await countVisitors('proj-1')).toBe(2)
  })

  it('never returns a negative count', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ total: -5 }) }))
    expect(await countVisitors('proj-1')).toBe(0)
  })
})
