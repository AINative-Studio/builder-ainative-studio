import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they
// must be set BEFORE the import executes. vi.hoisted() runs above imports.
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import { migrateGuestCompanies } from '@/lib/build/app-registry'

/**
 * #49 — migrateGuestCompanies re-keys anonymous guest-built companies to a real
 * account on register/login. We mock global fetch to observe registry reads
 * (resolveApp GET) and writes (registerApp POST) without a real ZeroDB call.
 *
 * resolveApp reads via GET (?limit=1000) and filters rows to the requested slug;
 * so for a single-slug read we return only that slug's rows. registerApp writes
 * via POST. The helper reads then (maybe) writes per slug, in order.
 */
function rowsResponse(rows: any[]): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: rows.map((r) => ({ row_data: r })) }),
  } as unknown as Response
}
function okResponse(): Response {
  return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
}
function row(slug: string, extra: Record<string, unknown> = {}): any {
  return { slug, chatId: `chat-${slug}`, createdAt: '2026-08-01T00:00:00Z', ...extra }
}

describe('migrateGuestCompanies (#49)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns empty when no email is given (nothing to migrate into)', async () => {
    const res = await migrateGuestCompanies(['acme'], '')
    expect(res).toEqual({ migrated: [], skipped: [] })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns empty when the slug list is empty', async () => {
    const res = await migrateGuestCompanies([], 'founder@acme.com')
    expect(res).toEqual({ migrated: [], skipped: [] })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('claims an UNOWNED guest company for the account (GET then POST)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme')])) // resolveApp
    fetchMock.mockResolvedValueOnce(okResponse()) // registerApp POST

    const res = await migrateGuestCompanies(['acme'], 'Founder@Acme.com')
    expect(res.migrated).toEqual(['acme'])
    expect(res.skipped).toEqual([])

    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    // Email is lowercased and stamped as owner.
    expect(body.row_data.ownerEmail).toBe('founder@acme.com')
    expect(body.row_data.slug).toBe('acme')
  })

  it('is IDEMPOTENT — a company already owned by THIS account is a no-op success, no POST', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([row('acme', { ownerEmail: 'founder@acme.com' })]),
    )
    const res = await migrateGuestCompanies(['acme'], 'founder@acme.com')
    expect(res.migrated).toEqual(['acme'])
    expect(res.skipped).toEqual([])
    const posts = fetchMock.mock.calls.filter((c: any[]) => c[1]?.method === 'POST')
    expect(posts.length).toBe(0)
  })

  it('NEVER steals a company owned by a DIFFERENT account (skipped, no POST)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([row('acme', { ownerEmail: 'someone-else@rival.com' })]),
    )
    const res = await migrateGuestCompanies(['acme'], 'founder@acme.com')
    expect(res.migrated).toEqual([])
    expect(res.skipped).toEqual(['acme'])
    const posts = fetchMock.mock.calls.filter((c: any[]) => c[1]?.method === 'POST')
    expect(posts.length).toBe(0)
  })

  it('skips an unregistered slug', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([])) // resolveApp → nothing
    const res = await migrateGuestCompanies(['ghost'], 'founder@acme.com')
    expect(res.migrated).toEqual([])
    expect(res.skipped).toEqual(['ghost'])
  })

  it('de-duplicates repeated / blank slugs before processing', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    // Only one distinct slug ("acme") should be resolved → one GET + one POST.
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme')]))
    fetchMock.mockResolvedValueOnce(okResponse())
    const res = await migrateGuestCompanies(['acme', 'acme', '', '  '], 'founder@acme.com')
    expect(res.migrated).toEqual(['acme'])
    const gets = fetchMock.mock.calls.filter((c: any[]) => !c[1] || c[1]?.method !== 'POST')
    expect(gets.length).toBe(1)
  })

  it('processes a MIX: claims unowned, keeps own, skips foreign + unregistered', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    // Order of slugs: mine (owned by me), free (unowned), rival (foreign), ghost (missing)
    fetchMock
      .mockResolvedValueOnce(rowsResponse([row('mine', { ownerEmail: 'founder@acme.com' })])) // mine: GET
      .mockResolvedValueOnce(rowsResponse([row('free')])) // free: GET
      .mockResolvedValueOnce(okResponse()) // free: POST claim
      .mockResolvedValueOnce(rowsResponse([row('rival', { ownerEmail: 'x@y.com' })])) // rival: GET
      .mockResolvedValueOnce(rowsResponse([])) // ghost: GET (missing)

    const res = await migrateGuestCompanies(['mine', 'free', 'rival', 'ghost'], 'founder@acme.com')
    expect(res.migrated.sort()).toEqual(['free', 'mine'])
    expect(res.skipped.sort()).toEqual(['ghost', 'rival'])
  })

  it('marks a slug skipped when the registry write fails', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme')])) // resolveApp
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}), text: async () => '' } as unknown as Response)
    const res = await migrateGuestCompanies(['acme'], 'founder@acme.com')
    expect(res.migrated).toEqual([])
    expect(res.skipped).toEqual(['acme'])
  })
})
