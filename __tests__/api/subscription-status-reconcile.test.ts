import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * GET /api/build/subscription/status (#844 follow-up) — real bug fix,
 * agentive/amador@selfpreneur.com, a real paying Pro customer whose company
 * registry stayed permanently on plan:null and a tmp_ key because the ONLY
 * place that ever fixed it (subscription/verify) requires a completed Stripe
 * redirect round-trip with no webhook fallback. This route already resolves
 * the founder's REAL current plan on every Live dashboard load — it now also
 * reconciles a stale registry against that real plan when a slug is passed.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  fetchCorePlanIdentity: vi.fn(),
  reconcilePlanFulfillment: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/ainative/resolve-plan', () => ({ fetchCorePlanIdentity: h.fetchCorePlanIdentity }))
vi.mock('@/lib/build/app-registry', () => ({ reconcilePlanFulfillment: h.reconcilePlanFulfillment }))

import { GET } from '@/app/api/build/subscription/status/route'

function getReq(url: string) {
  return { nextUrl: new URL(url) } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  h.reconcilePlanFulfillment.mockResolvedValue({ planFixed: false, keyClaimed: false })
})

describe('GET /api/build/subscription/status', () => {
  it('returns signedIn:false and never reconciles when there is no session token', async () => {
    h.auth.mockResolvedValue(null)
    const res: any = await GET(getReq('http://localhost/api/build/subscription/status?slug=agentive'))
    const json = await res.json()
    expect(json).toEqual({ plan: null, signedIn: false })
    expect(h.reconcilePlanFulfillment).not.toHaveBeenCalled()
  })

  it('never reconciles when the plan could not be verified', async () => {
    h.auth.mockResolvedValue({ accessToken: 'jwt-1' })
    h.fetchCorePlanIdentity.mockResolvedValue({ verified: false })
    const res: any = await GET(getReq('http://localhost/api/build/subscription/status?slug=agentive'))
    const json = await res.json()
    expect(json).toEqual({ plan: null, signedIn: true })
    expect(h.reconcilePlanFulfillment).not.toHaveBeenCalled()
  })

  it('never reconciles for a free/unpaid account, even with a slug present', async () => {
    h.auth.mockResolvedValue({ accessToken: 'jwt-1' })
    h.fetchCorePlanIdentity.mockResolvedValue({ verified: true, admin: false, rawPlan: 'hobbyist', email: 'f@x.com' })
    const res: any = await GET(getReq('http://localhost/api/build/subscription/status?slug=agentive'))
    const json = await res.json()
    expect(json.plan).toBeNull()
    expect(h.reconcilePlanFulfillment).not.toHaveBeenCalled()
  })

  it('never reconciles when no slug is passed, even for a genuinely paid account', async () => {
    h.auth.mockResolvedValue({ accessToken: 'jwt-1' })
    h.fetchCorePlanIdentity.mockResolvedValue({ verified: true, admin: false, rawPlan: 'pro', email: 'f@x.com' })
    const res: any = await GET(getReq('http://localhost/api/build/subscription/status'))
    const json = await res.json()
    expect(json.plan).toBe('pro')
    expect(h.reconcilePlanFulfillment).not.toHaveBeenCalled()
  })

  // THE BUG FIX — the exact agentive repro: a real, verified, paid Pro
  // account with a slug present must trigger reconciliation using the
  // founder's OWN real session token.
  it('THE FIX: reconciles using the founder\'s real token when genuinely paid + slug present (the agentive repro)', async () => {
    h.auth.mockResolvedValue({ accessToken: 'amadors-real-jwt' })
    h.fetchCorePlanIdentity.mockResolvedValue({ verified: true, admin: false, rawPlan: 'pro', email: 'amador@selfpreneur.com' })
    const res: any = await GET(getReq('http://localhost/api/build/subscription/status?slug=agentive'))
    const json = await res.json()
    expect(json.plan).toBe('pro')
    expect(h.reconcilePlanFulfillment).toHaveBeenCalledWith('agentive', 'pro', 'amadors-real-jwt')
  })

  it('admins are treated as enterprise and never trigger reconciliation (staff bypass, not a real per-company plan)', async () => {
    h.auth.mockResolvedValue({ accessToken: 'admin-jwt' })
    h.fetchCorePlanIdentity.mockResolvedValue({ verified: true, admin: true, email: 'admin@ainative.studio' })
    const res: any = await GET(getReq('http://localhost/api/build/subscription/status?slug=agentive'))
    const json = await res.json()
    expect(json.plan).toBe('enterprise')
    expect(h.reconcilePlanFulfillment).not.toHaveBeenCalled()
  })

  it('a reconciliation failure never fails or blocks the response', async () => {
    h.auth.mockResolvedValue({ accessToken: 'jwt-1' })
    h.fetchCorePlanIdentity.mockResolvedValue({ verified: true, admin: false, rawPlan: 'pro', email: 'f@x.com' })
    h.reconcilePlanFulfillment.mockRejectedValue(new Error('boom'))
    const res: any = await GET(getReq('http://localhost/api/build/subscription/status?slug=agentive'))
    expect(res.status).toBe(200) // never fails the response even though reconciliation rejected
    const json = await res.json()
    expect(json.plan).toBe('pro')
  })
})
