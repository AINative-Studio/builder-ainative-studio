import { describe, it, expect, vi, afterEach } from 'vitest'
import { countVisitors } from '@/lib/build/visitor-metrics'

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
