import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #449 — POST /api/build/growth/ad-budget-checkout. Properties under test:
 *  - disabled by default (flag off) — never calls core, never requires auth;
 *  - requires a slug (400);
 *  - requires a positive amountCents (400);
 *  - requires sign-in (reason:'signin');
 *  - requires a paid tier (reason:'tier');
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
vi.mock('@/lib/ainative/plan', () => ({ getPlanStatus: h.getPlanStatus }))
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

  it('blocks a non-paid (hobbyist) tier', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'hobbyist' })
    const { POST } = await import('@/app/api/build/growth/ad-budget-checkout/route')
    const res: any = await POST(postReq({ slug: 'acme', amountCents: 1000 }))
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'tier', tier: 'hobbyist' })
  })

  it('404s on an unknown company', async () => {
    h.resolveApp.mockResolvedValue(null)
    const { POST } = await import('@/app/api/build/growth/ad-budget-checkout/route')
    const res: any = await POST(postReq({ slug: 'nope', amountCents: 1000 }))
    expect(res.status).toBe(404)
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
