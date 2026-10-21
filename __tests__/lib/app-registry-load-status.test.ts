import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they
// must be set BEFORE the import executes. vi.hoisted() runs above imports.
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import {
  listAllApps,
  listAllAppsWithStatus,
  listAppsForOwner,
  listAppsForOwnerWithStatus,
  resolveApp,
  resolveAppVerified,
  __resetRegistryCacheForTests,
} from '@/lib/build/app-registry'

/**
 * Real bug found live (2026-09-13, core#7395): Builder's own ZeroDB registry
 * project started returning 403 on every read, platform-wide. listAllApps()'s
 * own `if (!res.ok) return []` made that outage indistinguishable from "no
 * companies exist" — a real founder (arif@8genc.com) reported their projects
 * had "disappeared" from the dashboard, when the actual cause was a database
 * outage. listAllAppsWithStatus()/listAppsForOwnerWithStatus() report whether
 * the read genuinely succeeded, so a caller (my-companies route) can surface
 * an honest error instead of a false empty list.
 */

function rowsResponse(rows: any[]): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: rows.map((r) => ({ row_data: r })) }),
  } as unknown as Response
}

function failResponse(status = 403): Response {
  return { ok: false, status, text: async () => '{"detail":"not scoped"}' } as unknown as Response
}

function row(slug: string, extra: Record<string, unknown> = {}): any {
  return { slug, chatId: `chat-${slug}`, createdAt: '2026-08-01T00:00:00Z', ...extra }
}

describe('listAllAppsWithStatus', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); __resetRegistryCacheForTests() })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('reports ok:true with the real rows on a successful read', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(rowsResponse([row('ember-box')]))
    const result = await listAllAppsWithStatus()
    expect(result.ok).toBe(true)
    expect(result.apps).toHaveLength(1)
    expect(result.apps[0].slug).toBe('ember-box')
  })

  it('reports ok:false (not a genuine empty list) when the read fails with a real error status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(failResponse(403))
    const result = await listAllAppsWithStatus()
    expect(result.ok).toBe(false)
    expect(result.apps).toEqual([])
  })

  it('reports ok:false when the fetch itself throws', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'))
    const result = await listAllAppsWithStatus()
    expect(result.ok).toBe(false)
    expect(result.apps).toEqual([])
  })

  it('listAllApps() (the pre-existing function) still returns a plain array, unaffected by the new ok tracking', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(rowsResponse([row('ember-box')]))
    const apps = await listAllApps()
    expect(Array.isArray(apps)).toBe(true)
    expect(apps).toHaveLength(1)
  })

  it('listAllApps() still returns [] (not throwing) on a real failure — pre-existing fail-open callers are unaffected', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(failResponse(500))
    const apps = await listAllApps()
    expect(apps).toEqual([])
  })

  /**
   * Real bug found live (#1106, 2026-10-16): a company soft-deleted via
   * Danger Zone (setAppLifecycle(slug, 'deleted') appends a NEW row with
   * lifecycleStatus:'deleted' — the registry is append-only, latest-wins)
   * still showed up here, even though resolveAppVerified() (the single-slug
   * read EVERY other code path uses) already excludes a latest row whose
   * lifecycleStatus is 'deleted'. A founder could see an already-deleted
   * company in "My Companies" (/api/build/my-companies, which calls this
   * function) and click its own delete button, which then genuinely failed
   * with "not_owner" — not because of any real ownership problem, but
   * because resolveApp() correctly found no live entry to act on.
   */
  it('excludes a company whose LATEST row is soft-deleted (lifecycleStatus "deleted"), matching resolveAppVerified\'s own contract', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(rowsResponse([
      row('delete-test-owned', { ownerEmail: 'admin@ainative.studio', createdAt: '2026-09-12T07:46:24.005Z' }),
      row('delete-test-owned', { ownerEmail: 'admin@ainative.studio', createdAt: '2026-09-12T07:46:28.615Z', lifecycleStatus: 'deleted' }),
      row('still-live', { ownerEmail: 'admin@ainative.studio' }),
    ]))
    const result = await listAllAppsWithStatus()
    expect(result.ok).toBe(true)
    expect(result.apps.map((a) => a.slug)).toEqual(['still-live'])
  })
})

describe('listAppsForOwnerWithStatus', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); __resetRegistryCacheForTests() })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('filters to the owner\'s own apps and reports ok:true on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(rowsResponse([
      row('ember-box', { ownerEmail: 'arif@8genc.com' }),
      row('other-co', { ownerEmail: 'someone-else@example.com' }),
    ]))
    const result = await listAppsForOwnerWithStatus('arif@8genc.com')
    expect(result.ok).toBe(true)
    expect(result.apps).toHaveLength(1)
    expect(result.apps[0].slug).toBe('ember-box')
  })

  it('reports ok:false (never a false empty list) when the underlying read fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(failResponse(403))
    const result = await listAppsForOwnerWithStatus('arif@8genc.com')
    expect(result.ok).toBe(false)
    expect(result.apps).toEqual([])
  })

  it('reports ok:false for an empty/missing email, same as the pre-existing behavior', async () => {
    const result = await listAppsForOwnerWithStatus('')
    expect(result.ok).toBe(false)
    expect(result.apps).toEqual([])
  })

  it('listAppsForOwner() (the pre-existing function) still returns a plain filtered array', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(rowsResponse([row('ember-box', { ownerEmail: 'arif@8genc.com' })]))
    const apps = await listAppsForOwner('arif@8genc.com')
    expect(apps).toHaveLength(1)
  })
})

/**
 * Real bug (#1106, filed 2026-10-16): every read in this file (listAllApps,
 * listAppsForOwner, resolveApp/resolveAppVerified, and anything built on
 * them) fetched exactly ONE `?limit=1000` page of `builder_app_registry` —
 * an append-only table that has very likely grown past 1000 total rows in
 * production. Whichever rows fell past that single-page boundary went
 * silently invisible: a real founder's older company could become
 * unresolvable (danger-zone actions wrongly reject as "not_owner",
 * /build/{slug} 404s unpredictably) with zero error surfaced anywhere.
 * Fixed by paging through with `skip`, mirroring loop-enrollment.ts's
 * fetchAllRows() (same rows API, same append-only-growth problem, on a
 * sibling table) — bounded so a pathological table still can't hang a
 * request.
 */
function pagedRowsFetch(pages: any[][]): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string | URL | Request) => {
    const match = String(url).match(/skip=(\d+)/)
    const skip = match ? Number(match[1]) : 0
    const pageIndex = skip / 1000
    const rows = pages[pageIndex] ?? []
    const hasMore = pageIndex < pages.length - 1
    const body = { data: rows.map((r) => ({ row_data: r })), has_more: hasMore }
    return { ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response
  })
}

describe('builder_app_registry pagination (#1106)', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); __resetRegistryCacheForTests() })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('listAllAppsWithStatus finds a slug that only exists past the first 1000-row page', async () => {
    const page0 = Array.from({ length: 1000 }, (_, i) => row(`co-${i}`))
    const page1 = [row('beacon', { createdAt: '2026-10-19T00:00:00Z' })]
    vi.stubGlobal('fetch', pagedRowsFetch([page0, page1]))
    const result = await listAllAppsWithStatus()
    expect(result.ok).toBe(true)
    expect(result.apps.some((a) => a.slug === 'beacon')).toBe(true)
    expect(result.apps).toHaveLength(1001)
  })

  it('resolveApp finds a slug whose only row is past the first page', async () => {
    const page0 = Array.from({ length: 1000 }, (_, i) => row(`co-${i}`))
    const page1 = [row('beacon', { createdAt: '2026-10-19T00:00:00Z' })]
    vi.stubGlobal('fetch', pagedRowsFetch([page0, page1]))
    const entry = await resolveApp('beacon')
    expect(entry?.slug).toBe('beacon')
  })

  it('stops paginating once a page comes back short of the page size', async () => {
    const fn = pagedRowsFetch([[row('only-one')]])
    vi.stubGlobal('fetch', fn)
    await listAllAppsWithStatus()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('is bounded — a pathological always-full-page response cannot hang the request forever', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => row(`co-${i}`))
    const fn = vi.fn(async () => {
      const body = { data: fullPage.map((r) => ({ row_data: r })), has_more: true }
      return { ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response
    })
    vi.stubGlobal('fetch', fn)
    await listAllAppsWithStatus()
    expect(fn.mock.calls.length).toBeLessThanOrEqual(50)
  })

  it('fails closed (ok:false, verified:false) when a LATER page fails, never returning a partial result as confirmed', async () => {
    const page0 = Array.from({ length: 1000 }, (_, i) => row(`co-${i}`))
    const fn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('skip=1000')) {
        return { ok: false, status: 500, text: async () => '{"detail":"boom"}' } as unknown as Response
      }
      const body = { data: page0.map((r) => ({ row_data: r })), has_more: true }
      return { ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response
    })
    vi.stubGlobal('fetch', fn)
    const listResult = await listAllAppsWithStatus()
    expect(listResult.ok).toBe(false)
    expect(listResult.apps).toEqual([])

    vi.stubGlobal('fetch', fn)
    const verified = await resolveAppVerified('co-999')
    expect(verified.verified).toBe(false)
    expect(verified.entry).toBeNull()
  })
})
