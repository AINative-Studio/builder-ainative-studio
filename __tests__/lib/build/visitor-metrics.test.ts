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

import { countVisitors, listVisitors } from '@/lib/build/visitor-metrics'

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
 * production had NO `zerodbProjectId` at all (none of the 11 real admin-owned
 * companies were provisioned with a dedicated ZeroDB project — they're all
 * pre-paid trial/guest builds). `/api/db/{table}` itself already handles this
 * by falling back to a SHARED_PROJECT_ID for any unprovisioned app (see
 * app/api/db/[table]/route.ts's `resolveProject`) — but this module only ever
 * checked the per-app project, which is `undefined` for these apps, so it
 * never even looked in the shared project where the real beacon rows
 * actually landed. Confirmed live: real rows exist in the shared project's
 * `visitors` table (e.g. a real row from this session's own fresh-generation
 * test), while every company's dashboard read a permanent 0.
 *
 * The shared table has no per-company column — a generated app has no way to
 * know its own registered slug at runtime, so the beacon can only record
 * `path: window.location.pathname`, which is the PREVIEW route
 * (`/api/preview/{chatId}`), not the slug. chatId IS 1:1 with a company
 * (app-registry.ts), so scope the shared-project count by matching the
 * requesting company's own chatId inside that path string.
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

/**
 * listVisitors() — the entries behind VisitorsPanel (same bar as
 * WaitlistPanel: real data, real empty state, zero fabrication).
 * countVisitors() above delegates to this, so these tests also cover the
 * shape the panel renders.
 */
describe('listVisitors', () => {
  it('returns [] without a projectId AND without a chatId — nothing to scope by', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await listVisitors(undefined, undefined)).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a provisioned company reads real entries from its OWN project with its OWN key', async () => {
    const rows = [
      { row_data: { path: '/api/preview/chat-1', ts: '2026-10-19T12:00:00.000Z' } },
      { row_data: { path: '/api/preview/chat-1', ts: '2026-10-18T09:00:00.000Z' } },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: rows }) }))
    const entries = await listVisitors('proj-1', 'chat-1')
    expect(entries).toEqual([
      { path: '/api/preview/chat-1', visitedAt: '2026-10-19T12:00:00.000Z' },
      { path: '/api/preview/chat-1', visitedAt: '2026-10-18T09:00:00.000Z' },
    ])
  })

  it('sorts newest-first by visitedAt', async () => {
    const rows = [
      { row_data: { path: '/p', ts: '2026-09-01T00:00:00.000Z' } },
      { row_data: { path: '/p', ts: '2026-09-22T00:00:00.000Z' } },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: rows }) }))
    const entries = await listVisitors('proj-1', 'chat-1')
    expect(entries[0].visitedAt).toBe('2026-09-22T00:00:00.000Z')
    expect(entries[1].visitedAt).toBe('2026-09-01T00:00:00.000Z')
  })

  it('scopes the shared-project fallback by chatId, same as countVisitors', async () => {
    const rows = [
      { row_data: { path: '/api/preview/chat-A', ts: '2026-10-19T00:00:00.000Z' } },
      { row_data: { path: '/api/preview/chat-B', ts: '2026-10-19T00:00:00.000Z' } },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: rows }) }))
    const entries = await listVisitors(undefined, 'chat-A')
    expect(entries).toEqual([{ path: '/api/preview/chat-A', visitedAt: '2026-10-19T00:00:00.000Z' }])
  })

  it('returns [] on a non-ok response — never throws, never fabricates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    expect(await listVisitors('proj-1', 'chat-1')).toEqual([])
  })

  it('returns [] (never throws) on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
    expect(await listVisitors('proj-1', 'chat-1')).toEqual([])
  })

  it('#806: a provisioned company with NO stored key returns [] and never calls ZeroDB with the wrong key', async () => {
    h.resolveCompanyZerodbKey.mockResolvedValue({ ok: false, reason: 'not_stored' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await listVisitors('legacy-proj', 'chat-1')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('countVisitors stays in lockstep with listVisitors (count === entries.length)', async () => {
    const rows = [
      { row_data: { path: '/p', ts: '2026-10-19T00:00:00.000Z' } },
      { row_data: { path: '/p', ts: '2026-10-18T00:00:00.000Z' } },
      { row_data: { path: '/p', ts: '2026-10-17T00:00:00.000Z' } },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: rows }) }))
    const [count, entries] = await Promise.all([countVisitors('proj-1', 'chat-1'), listVisitors('proj-1', 'chat-1')])
    expect(count).toBe(entries.length)
  })
})
