import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #449 — POST /api/build/growth/ad-budget-checkout. Properties under test:
 *  - disabled by default (flag off) — never calls core, never requires auth;
 *  - requires a slug (400);
 *  - requires a positive amountCents (400);
 *  - requires sign-in (reason:'signin');
 *  - is NOT gated on plan tier (#1017, 2026-10-10 product direction) — any
 *    signed-in founder, free tier included, can purchase prepaid ad credits;
 *  - 404s on an unknown company;
 *  - a valid request proxies to core and returns its checkout URL;
 *  - a core failure is surfaced honestly, never fabricated as success.
 * All collaborators are mocked; no real network call is made.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getPlanStatus: vi.fn(),
  resolveApp: vi.fn(),
  growthAdTestingEnabled: vi.fn(() => true),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
// isPaidTier stays REAL so the route's actual paid-tier gate is exercised (#762).
vi.mock('@/lib/ainative/plan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ainative/plan')>()),
  getPlanStatus: h.getPlanStatus,
}))
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/build/ad-testing', () => ({ growthAdTestingEnabled: h.growthAdTestingEnabled }))

function postReq(body: unknown) {
  return { json: async () => body } as any
}

const APP = { slug: 'acme', chatId: 'c1', createdAt: '2026-01-01' }

beforeEach(() => {
  vi.clearAllMocks()
  h.growthAdTestingEnabled.mockReturnValue(true)
  h.auth.mockResolvedValue({ accessToken: 'tok' })
  h.getPlanStatus.mockResolvedValue({ tier: 'pro' })
  h.resolveApp.mockResolvedValue(APP)
})

describe('POST /api/build/growth/ad-budget-checkout (#449)', () => {
  it('is disabled by default and never calls auth/core', async () => {
    h.growthAdTestingEnabled.mockReturnValue(false)
    const { POST } = await import('@/app/api/build/growth/ad-budget-checkout/route')
    const res: any = await POST(postReq({ slug: 'acme', amountCents: 1000 }))
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.reason).toBe('disabled')
    expect(h.auth).not.toHaveBeenCalled()
  })

  it('requires a slug', async () => {
    const { POST } = await import('@/app/api/build/growth/ad-budget-checkout/route')
    const res: any = await POST(postReq({ amountCents: 1000 }))
    expect(res.status).toBe(400)
  })

  it('requires a positive amountCents', async () => {
    const { POST } = await import('@/app/api/build/growth/ad-budget-checkout/route')
    const res: any = await POST(postReq({ slug: 'acme', amountCents: 0 }))
    expect(res.status).toBe(400)
  })

  it('requires sign-in', async () => {
    h.auth.mockResolvedValue(null)
    const { POST } = await import('@/app/api/build/growth/ad-budget-checkout/route')
    const res: any = await POST(postReq({ slug: 'acme', amountCents: 1000 }))
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'signin' })
  })

  // ── #1017: credits purchase is NOT plan-gated ───────────────────────────────
  // Product direction confirmed 2026-10-10: ad campaigns are not gated on plan
  // tier. Founders pay for prepaid ad CREDITS to fund a campaign, and a
  // free-tier founder validating demand for their idea is exactly who that is
  // for. The old `isPaidTier` gate here made the funding flow a dead end — a
  // free founder got an auto-created PAUSED campaign (#1017's auto-create path)
  // plus a prompt to fund it, then was refused with reason:'tier' the moment
  // they tried to pay.
  it('lets a free-tier (hobbyist) founder reach real Stripe checkout — no tier gate (#1017)', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'hobbyist' })
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/session/free-tier' }),
    } as any))
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await import('@/app/api/build/growth/ad-budget-checkout/route')
    const res: any = await POST(postReq({ slug: 'acme', amountCents: 500 }))
    const json = await res.json()
    expect(json).toEqual({ ok: true, url: 'https://checkout.stripe.com/session/free-tier' })
    // Reached the REAL checkout-creation call, not short-circuited by a gate.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('lets a founder with NO resolvable plan at all reach checkout (#1017)', async () => {
    // A core plan lookup that outright fails must no longer block a purchase:
    // nothing about ad credits depends on knowing the founder's plan.
    h.getPlanStatus.mockRejectedValue(new Error('core unreachable'))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/session/no-plan' }),
    } as any))
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await import('@/app/api/build/growth/ad-budget-checkout/route')
    const res: any = await POST(postReq({ slug: 'acme', amountCents: 500 }))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.url).toBe('https://checkout.stripe.com/session/no-plan')
    vi.unstubAllGlobals()
  })

  it('never refuses a purchase with reason:"tier" for any plan (#1017)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ url: 'https://x' }) } as any)))
    const { POST } = await import('@/app/api/build/growth/ad-budget-checkout/route')
    for (const tier of ['hobbyist', 'starter', 'pro', 'business', 'enterprise', undefined]) {
      h.getPlanStatus.mockResolvedValue({ tier })
      const res: any = await POST(postReq({ slug: 'acme', amountCents: 500 }))
      const json = await res.json()
      expect(json.reason).not.toBe('tier')
      expect(json.ok).toBe(true)
    }
    vi.unstubAllGlobals()
  })

  it('still refuses a genuinely unauthenticated request — the sign-in check is UNCHANGED (#1017)', async () => {
    // Removing the tier gate must not weaken authentication: this is a
    // real-money endpoint and an anonymous caller must never reach Stripe.
    h.auth.mockResolvedValue(null)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await import('@/app/api/build/growth/ad-budget-checkout/route')
    const res: any = await POST(postReq({ slug: 'acme', amountCents: 1000 }))
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'signin' })
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('still refuses a session with no access token (#1017)', async () => {
    h.auth.mockResolvedValue({ user: { email: 'f@x.com' } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await import('@/app/api/build/growth/ad-budget-checkout/route')
    const res: any = await POST(postReq({ slug: 'acme', amountCents: 1000 }))
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'signin' })
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('forwards the founder OWN bearer token to core — ownership is verified there, never bypassed', async () => {
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      expect(init.headers.Authorization).toBe('Bearer tok')
      return { ok: true, json: async () => ({ url: 'https://x' }) } as any
    })
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await import('@/app/api/build/growth/ad-budget-checkout/route')
    await POST(postReq({ slug: 'acme', amountCents: 1000 }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('404s on an unknown company — company resolution is UNCHANGED (#1017)', async () => {
    h.resolveApp.mockResolvedValue(null)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await import('@/app/api/build/growth/ad-budget-checkout/route')
    const res: any = await POST(postReq({ slug: 'nope', amountCents: 1000 }))
    expect(res.status).toBe(404)
    // No company, no charge — never reaches Stripe.
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('proxies a valid request to core and returns the checkout URL', async () => {
    const fetchMock = vi.fn(async (url: string, init: any) => {
      expect(String(url)).toContain('/api/v1/public/ad-budget/checkout')
      const body = JSON.parse(init.body)
      expect(body.slug).toBe('acme')
      expect(body.amount_cents).toBe(1000)
      return { ok: true, json: async () => ({ url: 'https://checkout.stripe.com/session/xyz' }) } as any
    })
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await import('@/app/api/build/growth/ad-budget-checkout/route')
    const res: any = await POST(postReq({ slug: 'acme', amountCents: 1000 }))
    const json = await res.json()
    expect(json).toEqual({ ok: true, url: 'https://checkout.stripe.com/session/xyz' })
    vi.unstubAllGlobals()
  })

  it('surfaces a core failure honestly, never fabricates a checkout URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ detail: 'core down' }) } as any)))
    const { POST } = await import('@/app/api/build/growth/ad-budget-checkout/route')
    const res: any = await POST(postReq({ slug: 'acme', amountCents: 1000 }))
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.ok).toBe(false)
    vi.unstubAllGlobals()
  })
})
