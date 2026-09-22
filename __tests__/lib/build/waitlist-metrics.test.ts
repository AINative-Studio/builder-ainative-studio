import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #844: the real signups behind the Live dashboard's "waitlist" hero metric.
 * The write side already worked (primitive-catalog.ts's EMAIL/WAITLIST
 * CAPTURE block) — nothing ever read it back. Mirrors visitor-metrics.ts's
 * KEY SCOPING fix (#806) verbatim: a company's own ZeroDB project needs that
 * project's OWN stored key, never the shared service key.
 */
const h = vi.hoisted(() => ({ resolveCompanyZerodbKey: vi.fn() }))
vi.mock('@/lib/build/company-zerodb-credentials', () => ({
  resolveCompanyZerodbKey: h.resolveCompanyZerodbKey,
}))

import { listWaitlist, countWaitlist } from '@/lib/build/waitlist-metrics'

beforeEach(() => {
  vi.clearAllMocks()
  h.resolveCompanyZerodbKey.mockResolvedValue({ ok: true, apiKey: 'sk_company_scoped_key' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('listWaitlist', () => {
  it('returns [] without a projectId — no dedicated table to read', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await listWaitlist(undefined)).toEqual([])
    expect(await listWaitlist(null)).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a provisioned company reads real rows from its OWN project with its OWN key', async () => {
    const rows = [
      { row_data: { email: 'a@x.com', joinedAt: '2026-09-20T00:00:00.000Z' } },
      { row_data: { email: 'b@x.com', joinedAt: '2026-09-21T00:00:00.000Z' } },
    ]
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: rows }) })
    vi.stubGlobal('fetch', fetchMock)
    const entries = await listWaitlist('proj-1')
    expect(entries).toHaveLength(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/projects/proj-1/')
    expect(h.resolveCompanyZerodbKey).toHaveBeenCalledWith('proj-1')
    expect(fetchMock.mock.calls[0][1].headers['X-API-Key']).toBe('sk_company_scoped_key')
  })

  it('sorts newest-first by joinedAt', async () => {
    const rows = [
      { row_data: { email: 'old@x.com', joinedAt: '2026-09-01T00:00:00.000Z' } },
      { row_data: { email: 'new@x.com', joinedAt: '2026-09-22T00:00:00.000Z' } },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: rows }) }))
    const entries = await listWaitlist('proj-1')
    expect(entries[0].email).toBe('new@x.com')
    expect(entries[1].email).toBe('old@x.com')
  })

  it('#806: a provisioned company with NO stored key returns [] and never calls ZeroDB with the wrong key', async () => {
    h.resolveCompanyZerodbKey.mockResolvedValue({ ok: false, reason: 'not_stored' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await listWaitlist('legacy-proj')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('filters out malformed rows with no email', async () => {
    const rows = [
      { row_data: { joinedAt: '2026-09-20T00:00:00.000Z' } },
      { row_data: { email: 'real@x.com', joinedAt: '2026-09-21T00:00:00.000Z' } },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: rows }) }))
    const entries = await listWaitlist('proj-1')
    expect(entries).toEqual([{ email: 'real@x.com', joinedAt: '2026-09-21T00:00:00.000Z' }])
  })

  it('returns [] on a non-ok response — never throws, never fabricates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    expect(await listWaitlist('proj-1')).toEqual([])
  })

  it('returns [] (never throws) on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
    expect(await listWaitlist('proj-1')).toEqual([])
  })

  it('handles a raw array response (no data wrapper)', async () => {
    const rows = [{ row_data: { email: 'a@x.com', joinedAt: '2026-09-20T00:00:00.000Z' } }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => rows }))
    expect(await listWaitlist('proj-1')).toHaveLength(1)
  })
})

describe('countWaitlist', () => {
  it('returns the length of listWaitlist', async () => {
    const rows = [
      { row_data: { email: 'a@x.com', joinedAt: '2026-09-20T00:00:00.000Z' } },
      { row_data: { email: 'b@x.com', joinedAt: '2026-09-21T00:00:00.000Z' } },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: rows }) }))
    expect(await countWaitlist('proj-1')).toBe(2)
  })

  it('returns 0 for a never-signed-up company, never fabricated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }))
    expect(await countWaitlist('proj-1')).toBe(0)
    expect(await countWaitlist(undefined)).toBe(0)
  })
})
