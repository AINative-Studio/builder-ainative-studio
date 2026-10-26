import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * #1538 follow-up — POST /api/build/checkout never sent the company slug to
 * core's /pricing/checkout proxy, only embedding it in success_url/cancel_url
 * (a browser-redirect destination Stripe never sees or echoes onto its own
 * session/subscription objects). Confirmed via cross-session coordination
 * with the core-side agent: core's webhook relay (built to close #1538's real
 * root cause — core never relays subscription events to Builder) has no way
 * to learn which company a Stripe event belongs to without this. Core fixed
 * its own passthrough gap (POST /pricing/checkout now merges a `metadata`
 * dict from the request body onto the real Stripe session + subscription,
 * via stripe_service.create_checkout_session's existing subscription_data.
 * metadata propagation) and asked Builder to send `metadata: {company_slug}`.
 */

import { POST } from '@/app/api/build/checkout/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('POST /api/build/checkout — company_slug metadata (#1538)', () => {
  it('sends metadata.company_slug to core when a real companyId is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://checkout.stripe.com/x' }) })
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(req({ priceId: 'price_123', plan: 'pro', companyId: 'acme-co' }))
    expect(res.status).toBe(200)

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init.body))
    expect(body.metadata).toEqual({ company_slug: 'acme-co' })
  })

  it('never sends a metadata field at all when there is no real companyId — no empty/fabricated slug', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://checkout.stripe.com/x' }) })
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ priceId: 'price_123', plan: 'pro' }))

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init.body))
    expect(body).not.toHaveProperty('metadata')
  })

  it('still sends the existing success_url/cancel_url company deep-link unchanged alongside the new metadata field', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://checkout.stripe.com/x' }) })
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ priceId: 'price_123', plan: 'pro', companyId: 'acme-co' }))

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init.body))
    expect(body.success_url).toContain('company=acme-co')
    expect(body.cancel_url).toContain('company=acme-co')
    expect(body.metadata).toEqual({ company_slug: 'acme-co' })
  })

  it('URL-safely handles a companyId needing encoding without corrupting the metadata value itself', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://checkout.stripe.com/x' }) })
    vi.stubGlobal('fetch', fetchMock)

    await POST(req({ priceId: 'price_123', plan: 'pro', companyId: 'my co & co' }))

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init.body))
    // metadata carries the RAW slug (JSON-encoded, not URL-encoded) — only
    // the query-string usages (success_url/cancel_url) need encodeURIComponent.
    expect(body.metadata).toEqual({ company_slug: 'my co & co' })
    expect(body.success_url).toContain(encodeURIComponent('my co & co'))
  })
})
