import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1454 — GET/POST /api/build/claim-subdomain must not collapse "the registry
 * read failed" into a confident answer.
 *
 * Pre-fix, the GET resolved with a plain `resolveApp(slug)` and returned
 * `{ claimed: entry?.subdomainClaimed === true }`, so a transient ZeroDB
 * timeout/rate-limit (entry: null) looked identical to a company that genuinely
 * hasn't claimed its subdomain — prompting a founder who already claimed
 * {slug}.ainative.studio to claim it again. The GET now reads through
 * resolveAppVerified() and answers an unverified read with a distinct 503
 * { unverified: true }, matching app/api/build/connect-domain/route.ts.
 *
 * The POST gained the same honesty on the way back out: claimSubdomain()'s new
 * `lookup_failed` reason maps to a retryable 503 rather than the old 404 that
 * told a paying founder their own company doesn't exist.
 *
 * All collaborators are mocked; no real ZeroDB/network call is made.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  claimSubdomain: vi.fn(),
  resolveAppVerified: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', () => ({
  claimSubdomain: h.claimSubdomain,
  resolveAppVerified: h.resolveAppVerified,
}))

import { GET, POST } from '@/app/api/build/claim-subdomain/route'

function getReq(qs: string) {
  return { url: `https://builder.ainative.studio/api/build/claim-subdomain?${qs}` } as any
}
function postReq(body: unknown) {
  return { json: async () => body } as any
}
/** A confirmed resolveAppVerified() result — a real entry or a confirmed miss. */
function verified(entry: Record<string, unknown> | null) {
  return { entry, verified: true }
}

beforeEach(() => {
  h.auth.mockResolvedValue({ user: { email: 'founder@acme.com' }, accessToken: 'tok' })
})
afterEach(() => vi.clearAllMocks())

describe('GET /api/build/claim-subdomain', () => {
  it('reports claimed:true for a company that really has claimed its subdomain', async () => {
    h.resolveAppVerified.mockResolvedValueOnce(
      verified({ slug: 'acme', chatId: 'c1', plan: 'pro', subdomainClaimed: true }),
    )
    const res = await GET(getReq('slug=acme'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.claimed).toBe(true)
    expect(body.unverified).toBeUndefined()
  })

  it('reports claimed:false when the lookup SUCCEEDS and the company genuinely has not claimed', async () => {
    h.resolveAppVerified.mockResolvedValueOnce(verified({ slug: 'acme', chatId: 'c1', plan: 'pro' }))
    const res = await GET(getReq('slug=acme'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.claimed).toBe(false)
    expect(body.unverified).toBeUndefined()
  })

  it('reports claimed:false for a confirmed-absent company (verified miss, not an error)', async () => {
    h.resolveAppVerified.mockResolvedValueOnce(verified(null))
    const res = await GET(getReq('slug=ghost'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.claimed).toBe(false)
  })

  it('503 unverified when the registry read itself fails (NOT a false claimed:false)', async () => {
    h.resolveAppVerified.mockResolvedValueOnce({ entry: null, verified: false })
    const res = await GET(getReq('slug=acme'))
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body.unverified).toBe(true)
    expect(body.reason).toBe('lookup_failed')
    // The honesty property: it must NOT assert the subdomain is unclaimed.
    expect(body.claimed).toBeUndefined()
  })

  it('503 unverified when resolveAppVerified rejects outright', async () => {
    h.resolveAppVerified.mockRejectedValueOnce(new Error('zerodb timeout'))
    const res = await GET(getReq('slug=acme'))
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body.unverified).toBe(true)
    expect(body.claimed).toBeUndefined()
  })

  // Regression guard on the source itself: the route must import the verified
  // resolver only. A future edit reintroducing `resolveApp` would silently restore
  // the collapsed null and all the behavioural tests above would still pass.
  it('imports resolveAppVerified and never the unverified resolveApp', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(
      new URL('../../app/api/build/claim-subdomain/route.ts', import.meta.url),
      'utf8',
    )
    // Strip comments — the fix's own doc comments name the old resolveApp() by design.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).toContain('resolveAppVerified')
    expect(code).not.toMatch(/\bresolveApp\b(?!Verified)/)
  })
})

describe('POST /api/build/claim-subdomain', () => {
  it('400 on a missing slug', async () => {
    const res = await POST(postReq({}))
    expect(res.status).toBe(400)
    expect(h.claimSubdomain).not.toHaveBeenCalled()
  })

  it('401 signin when anonymous', async () => {
    h.auth.mockResolvedValueOnce(null)
    const res = await POST(postReq({ slug: 'acme' }))
    const body = await res.json()
    expect(res.status).toBe(401)
    expect(body.reason).toBe('signin')
    expect(h.claimSubdomain).not.toHaveBeenCalled()
  })

  it('claims the subdomain for a signed-in founder on a paid plan', async () => {
    h.claimSubdomain.mockResolvedValueOnce({ ok: true, claimed: true })
    const res = await POST(postReq({ slug: 'acme' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, claimed: true })
  })

  it('402 for an unpaid company so the UI can route to upgrade', async () => {
    h.claimSubdomain.mockResolvedValueOnce({ ok: false, claimed: false, reason: 'not_paid' })
    const res = await POST(postReq({ slug: 'acme' }))
    expect(res.status).toBe(402)
  })

  it('404 for a confirmed-unregistered company', async () => {
    h.claimSubdomain.mockResolvedValueOnce({ ok: false, claimed: false, reason: 'not_registered' })
    const res = await POST(postReq({ slug: 'ghost' }))
    expect(res.status).toBe(404)
  })

  it('503 unverified (NOT 404) when the registry read behind the claim fails', async () => {
    h.claimSubdomain.mockResolvedValueOnce({ ok: false, claimed: false, reason: 'lookup_failed' })
    const res = await POST(postReq({ slug: 'acme' }))
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body.reason).toBe('lookup_failed')
    expect(body.unverified).toBe(true)
  })
})
