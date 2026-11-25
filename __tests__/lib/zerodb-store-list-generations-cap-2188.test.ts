import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #2188 — listGenerations() is a straight GET `.../rows?limit=N` with no
 * server-side order-by (same endpoint family as loadGeneration's documented
 * gap above it in this file). The table is append-only and grows with every
 * chat turn, not just every company, so every caller that hard-coded
 * `limit: 1000` (the showcase gallery, app-registry's unregistered-company
 * `/build/{slug}` fallback, and the obedience-backfill showcase sweep) could
 * silently stop seeing a company at all once the table outgrew that cap —
 * with no error, just an entry that quietly never appears.
 *
 * #2188 originally raised the default to 5000, reasoning it "matches the
 * ceiling this codebase already uses for other unbounded ZeroDB tables."
 * That premise was wrong and this test's own fully-mocked fetch never
 * caught it: api.ainative.studio's real, live OpenAPI spec declares `limit`'s
 * actual schema as `{maximum: 1000, minimum: 1, default: 100}` — there is no
 * 5000 ceiling on this endpoint, in this table or any other. Every
 * `limit=5000` call 422s in production (confirmed via Railway deploy logs;
 * /api/showcase's gallery dropped from ~163 entries to 11 as a direct
 * result). Reverted to 1000 — the real, confirmed-correct ceiling.
 */

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function okResponse(payload: unknown = {}) {
  return { ok: true, json: async () => payload, text: async () => '' }
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('listGenerations raises the old 1000-row hard cap (#2188)', () => {
  it('defaults to a 1000 row limit when called with no argument — the real API ceiling', async () => {
    const { listGenerations } = await import('@/lib/zerodb-store')
    fetchMock.mockResolvedValueOnce(okResponse({ data: [] }))
    await listGenerations()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('limit=1000')
  })

  it('still honors an explicit caller-supplied limit', async () => {
    const { listGenerations } = await import('@/lib/zerodb-store')
    fetchMock.mockResolvedValueOnce(okResponse({ data: [] }))
    await listGenerations(50)
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('limit=50')
  })
})
