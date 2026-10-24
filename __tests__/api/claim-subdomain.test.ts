import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #78 — POST/GET /api/build/claim-subdomain.
 *
 * Properties under test:
 *  - POST requires sign-in and a slug, and surfaces claimSubdomain()'s own reasons;
 *  - GET #1454 — a registry-read failure must be distinguishable from a genuine
 *    "not claimed", not collapsed into the same `claimed:false`.
 * All collaborators are mocked; no real network call is made.
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

import { POST, GET } from '@/app/api/build/claim-subdomain/route'

function postReq(body: unknown) {
  return { json: async () => body } as any
}
function getReq(qs: string) {
  return { url: `https://builder.ainative.studio/api/build/claim-subdomain?${qs}` } as any
}
function verified(entry: Record<string, unknown> | null) {
  return { entry, verified: true }
}

beforeEach(() => {
  h.auth.mockResolvedValue({ user: { email: 'f@x.com' } })
})
afterEach(() => vi.clearAllMocks())

describe('POST /api/build/claim-subdomain', () => {
  it('400 on a missing slug', async () => {
    const res = await POST(postReq({}))
    expect(res.status).toBe(400)
  })

  it('requires sign-in when anonymous', async () => {
    h.auth.mockResolvedValueOnce(null)
    const res = await POST(postReq({ slug: 'acme' }))
    const body = await res.json()
    expect(res.status).toBe(401)
    expect(body.reason).toBe('signin')
  })

  it('402 when the company is not on a paid plan', async () => {
    h.claimSubdomain.mockResolvedValueOnce({ ok: false, reason: 'not_paid' })
    const res = await POST(postReq({ slug: 'acme' }))
    const body = await res.json()
    expect(res.status).toBe(402)
    expect(body.reason).toBe('not_paid')
  })

  it('claims the subdomain on success', async () => {
    h.claimSubdomain.mockResolvedValueOnce({ ok: true, claimed: true })
    const res = await POST(postReq({ slug: 'acme' }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.claimed).toBe(true)
  })
})

describe('GET /api/build/claim-subdomain', () => {
  it('reports claimed:true for a company that claimed its subdomain', async () => {
    h.resolveAppVerified.mockResolvedValueOnce(verified({ slug: 'acme', subdomainClaimed: true }))
    const res = await GET(getReq('slug=acme'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.claimed).toBe(true)
  })

  it('reports claimed:false for a company confirmed not to have claimed it', async () => {
    h.resolveAppVerified.mockResolvedValueOnce(verified({ slug: 'acme', subdomainClaimed: false }))
    const res = await GET(getReq('slug=acme'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.claimed).toBe(false)
  })

  it('reports claimed:false for an unregistered company', async () => {
    h.resolveAppVerified.mockResolvedValueOnce(verified(null))
    const res = await GET(getReq('slug=ghost'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.claimed).toBe(false)
  })

  it('#1454 — 503 unverified when the registry read itself fails (NOT a false claimed:false)', async () => {
    h.resolveAppVerified.mockResolvedValueOnce({ entry: null, verified: false })
    const res = await GET(getReq('slug=acme'))
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body.unverified).toBe(true)
  })

  it('#1454 — 503 unverified when resolveAppVerified rejects outright', async () => {
    h.resolveAppVerified.mockRejectedValueOnce(new Error('zerodb timeout'))
    const res = await GET(getReq('slug=acme'))
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body.unverified).toBe(true)
  })
})
