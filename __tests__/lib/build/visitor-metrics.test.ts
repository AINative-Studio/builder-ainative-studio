import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #806 addendum: the per-project branch must use the key actually SCOPED to
 * that company's project. It used the SHARED service key, which ZeroDB rejects
 * (403 API_KEY_PROJECT_MISMATCH) — so every provisioned company's visitor count
 * read a permanent 0 regardless of real traffic, the 403 swallowed by the
 * fail-toward-0 policy. resolveCompanyZerodbKey is mocked here so these tests
 * exercise the counting logic; the real key store has its own suite in
 * __tests__/lib/build/company-zerodb-credentials.test.ts.
 */
const h = vi.hoisted(() => ({ resolveCompanyZerodbKey: vi.fn() }))
vi.mock('@/lib/build/company-zerodb-credentials', () => ({
  resolveCompanyZerodbKey: h.resolveCompanyZerodbKey,
}))

import { countVisitors } from '@/lib/build/visitor-metrics'

beforeEach(() => {
  vi.clearAllMocks()
  // Default: the company HAS a real stored, project-scoped key.
  h.resolveCompanyZerodbKey.mockResolvedValue({ ok: true, apiKey: 'sk_company_scoped_key' })
})

/**
 * #483/#563 — the real read side behind the Live dashboard's "visitors" hero
 * metric. Written by the mandated /api/db/visitors beacon every generated
 * landing page fires on mount.
 *
 * Real, live bug found post-deploy (2026-09-06): every company sampled in
 * production had NO zerodbProjectId (none were provisioned with a dedicated
 * ZeroDB project). The write side (/api/db/{table}) already falls back to a
 * SHARED project for any unprovisioned app, but this module only ever
 * checked the per-app project — so it never looked where the real beacon
 * rows actually landed, and every dashboard read a permanent 0 despite real
 * visits happening. Fixed: when `projectId` is absent, fall back to the
 * shared project and scope the count by matching the company's own `chatId`
 * inside each row's recorded `path` (the beacon can only record its own
 * preview route, `/api/preview/{chatId}`, not the company's slug).
 */

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('countVisitors', () => {
  it('returns 0 without a projectId AND without a chatId — nothing to scope by', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await countVisitors(undefined, undefined)).toBe(0)
    expect(await countVisitors(null, null)).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a provisioned company (real projectId) counts every row in its OWN project directly, no scoping needed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ row_data: { path: '/anything' } }, { row_data: { path: '/anything-else' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await countVisitors('proj-1', 'irrelevant-chat-id')).toBe(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/projects/proj-1/')
    // #806: with the company's OWN key, not the shared service key.
    expect(h.resolveCompanyZerodbKey).toHaveBeenCalledWith('proj-1')
    expect(fetchMock.mock.calls[0][1].headers['X-API-Key']).toBe('sk_company_scoped_key')
  })

  // ---- #806: the shared service key is NOT scoped to per-company projects. ----
  it('#806: a provisioned company with NO stored key reads 0 and never calls ZeroDB with the wrong key', async () => {
    h.resolveCompanyZerodbKey.mockResolvedValue({ ok: false, reason: 'not_stored' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await countVisitors('legacy-proj', 'chat-1')).toBe(0)
    // The whole point: it must not retry with the shared key against a project
    // that key isn't scoped to (that produced the silent 403 this fixes).
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // ---- THE REAL BUG: unprovisioned company (no projectId) falls back to the
  // shared project and must scope by chatId, since the shared table holds
  // every unprovisioned company's rows commingled with no company column. ----
  it('THE BUG: an unprovisioned company (no projectId) falls back to the shared project, scoped by chatId', async () => {
    const rows = [
      { row_data: { path: '/api/preview/chat-A' } },
      { row_data: { path: '/api/preview/chat-A' } },
      { row_data: { path: '/api/preview/chat-B' } }, // a DIFFERENT company's visit — must not count
    ]
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: rows }) })
    vi.stubGlobal('fetch', fetchMock)
    expect(await countVisitors(undefined, 'chat-A')).toBe(2)
    expect(await countVisitors(undefined, 'chat-B')).toBe(1)
    expect(await countVisitors(undefined, 'chat-C')).toBe(0)
  })

  it('never commingles two different companies\' shared-project visits', async () => {
    const rows = [
      { row_data: { path: '/api/preview/chat-A' } },
      { row_data: { path: '/api/preview/chat-B' } },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: rows }) }))
    const a = await countVisitors(undefined, 'chat-A')
    const b = await countVisitors(undefined, 'chat-B')
    expect(a).toBe(1)
    expect(b).toBe(1)
  })

  it('returns 0 for a never-visited app, never fabricated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }))
    expect(await countVisitors('proj-1', 'chat-1')).toBe(0)
    expect(await countVisitors(undefined, 'chat-1')).toBe(0)
  })

  it('returns 0 on a non-ok response (e.g. table not found yet) — never throws, never fabricates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    expect(await countVisitors('proj-1', 'chat-1')).toBe(0)
    expect(await countVisitors(undefined, 'chat-1')).toBe(0)
  })

  it('returns 0 (never throws) on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
    expect(await countVisitors('proj-1', 'chat-1')).toBe(0)
    expect(await countVisitors(undefined, 'chat-1')).toBe(0)
  })

  it('handles a raw array response (no data wrapper)', async () => {
    const rows = [{ row_data: { path: '/api/preview/chat-A' } }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => rows }))
    expect(await countVisitors(undefined, 'chat-A')).toBe(1)
  })
})
