/**
 * #2171 — MPP (Machine Payments Protocol) OpenAPI discovery annotations.
 * Mirrors the real reference pattern at `core`
 * (src/backend/app/services/mpp_discovery.py): x-payment-info/x-service-info
 * extensions derived from the SAME single source of truth the real checkout
 * flow uses (PRICING_TIERS, isAcpSigningConfigured) — never a fabricated
 * second price list, never an offer advertised when the live endpoint can't
 * actually honor it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/build/acp-signature', () => ({
  isAcpSigningConfigured: vi.fn(),
}))

import { isAcpSigningConfigured } from '@/lib/build/acp-signature'
import {
  buildPaymentOffers,
  buildServiceInfo,
  annotateOpenApiWithMpp,
  buildX402CrosshostOffers,
  annotateOpenApiWithX402Crosshost,
  MPP_PAID_OPERATION_PATH,
  MPP_PAID_OPERATION_METHOD,
  X402_CROSSHOST_OPERATION_PATH,
  X402_CROSSHOST_OPERATION_METHOD,
} from '@/lib/build/mpp-discovery'

describe('buildPaymentOffers', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('returns [] when ACP signing is not configured — never advertises an unpayable offer', () => {
    vi.mocked(isAcpSigningConfigured).mockReturnValue(false)
    expect(buildPaymentOffers()).toEqual([])
  })

  it('returns a real offer per PAID tier when signing is configured', () => {
    vi.mocked(isAcpSigningConfigured).mockReturnValue(true)
    const offers = buildPaymentOffers()
    expect(offers.length).toBeGreaterThan(0)
    for (const o of offers) {
      expect(o.intent).toBe('charge')
      expect(o.currency).toBe('USD')
      expect(Number(o.amount)).toBeGreaterThan(0)
      expect(o.plan_id).toBeTruthy()
      expect(o.method).toBeTruthy()
      expect(o.pay_to).toBeTruthy()
    }
  })

  // #2205 — the real AX checker (core's _is_valid_mpp_payment_info) only
  // requires amount/pay_to/method to be present and truthy, NOT plan_id/
  // currency/description/intent (those were this module's own invented
  // field names). Replicates the real validator's logic directly against
  // our own offers so a future field rename can't silently reintroduce
  // this exact bug (every offer here WAS structurally "valid-looking" by
  // this module's own shape, yet failed the real check for 2+ days before
  // #2205 found why).
  it('every offer satisfies the real checker\'s required-field validation (core\'s _MPP_PAYMENT_INFO_REQUIRED_OFFER_FIELDS: amount, pay_to, method)', () => {
    vi.mocked(isAcpSigningConfigured).mockReturnValue(true)
    const offers = buildPaymentOffers()
    const REQUIRED_OFFER_FIELDS = ['amount', 'pay_to', 'method'] as const
    const isValid = offers.some((offer) =>
      REQUIRED_OFFER_FIELDS.every((field) => Boolean((offer as unknown as Record<string, unknown>)[field])),
    )
    expect(isValid).toBe(true)
  })

  it('excludes the free ($0/mo) tier — it is not a real payable MPP offer', () => {
    vi.mocked(isAcpSigningConfigured).mockReturnValue(true)
    const offers = buildPaymentOffers()
    expect(offers.some((o) => o.plan_id === 'free')).toBe(false)
  })

  it('every offer amount matches PRICING_TIERS exactly — single source of truth, no second price list', async () => {
    vi.mocked(isAcpSigningConfigured).mockReturnValue(true)
    const { PRICING_TIERS } = await import('@/lib/build/pricing-tiers')
    const offers = buildPaymentOffers()
    for (const tier of PRICING_TIERS.filter((t) => t.monthly > 0)) {
      const offer = offers.find((o) => o.plan_id === tier.id)
      expect(offer?.amount).toBe(String(tier.monthly * 100))
    }
  })
})

describe('buildServiceInfo', () => {
  it('returns a real, non-empty service descriptor', () => {
    const info = buildServiceInfo()
    expect(info.name).toBeTruthy()
    expect(Array.isArray(info.categories)).toBe(true)
  })
})

describe('annotateOpenApiWithMpp', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  function baseSpec() {
    return {
      openapi: '3.1.0',
      paths: {
        [MPP_PAID_OPERATION_PATH]: {
          [MPP_PAID_OPERATION_METHOD]: { operationId: 'createAcpCheckoutSession' },
        },
      },
    }
  }

  it('leaves the spec untouched when there are no payable offers', () => {
    vi.mocked(isAcpSigningConfigured).mockReturnValue(false)
    const spec = baseSpec()
    const result = annotateOpenApiWithMpp(spec)
    expect(result['x-service-info']).toBeUndefined()
    expect((result.paths[MPP_PAID_OPERATION_PATH] as any)[MPP_PAID_OPERATION_METHOD]['x-payment-info']).toBeUndefined()
  })

  it('adds x-service-info at the document root and x-payment-info on the checkout operation', () => {
    vi.mocked(isAcpSigningConfigured).mockReturnValue(true)
    const result = annotateOpenApiWithMpp(baseSpec())
    expect(result['x-service-info']).toBeTruthy()
    const paymentInfo = (result.paths[MPP_PAID_OPERATION_PATH] as any)[MPP_PAID_OPERATION_METHOD]['x-payment-info']
    expect(paymentInfo).toBeTruthy()
    expect(Array.isArray(paymentInfo.offers)).toBe(true)
    expect(paymentInfo.offers.length).toBeGreaterThan(0)
    expect(paymentInfo.realm).toBeTruthy()
  })

  it('never throws on a malformed/missing paths shape — defensive, total', () => {
    vi.mocked(isAcpSigningConfigured).mockReturnValue(true)
    expect(() => annotateOpenApiWithMpp({})).not.toThrow()
    expect(() => annotateOpenApiWithMpp({ paths: null })).not.toThrow()
    expect(() => annotateOpenApiWithMpp({ paths: { [MPP_PAID_OPERATION_PATH]: null } })).not.toThrow()
    expect(() => annotateOpenApiWithMpp(null as any)).not.toThrow()
  })

  it('mutates and returns the same object (same contract as core\'s reference implementation)', () => {
    vi.mocked(isAcpSigningConfigured).mockReturnValue(true)
    const spec = baseSpec()
    const result = annotateOpenApiWithMpp(spec)
    expect(result).toBe(spec)
  })
})

/**
 * #2216 — MPP's challenge half can never be verified at builder.ainative.studio
 * itself (accepted architectural ceiling, #2204). This closes the gap via core's
 * REAL, already-live x402 subscribe 402 (confirmed live: a POST with
 * {"plan_id":"hobbyist"} returns a genuine 402 with a real WWW-Authenticate:
 * Payment header) — Builder is a client of this capability, not inventing one.
 */
describe('buildX402CrosshostOffers', () => {
  const REAL_PLANS_RESPONSE = {
    success: true,
    data: {
      plans: [
        { id: 'hobbyist', name: 'Hobbyist', amount: 500, pay_to: '0x5631a4d7516da6bc2712f91dc8489637b87e2f52', network: 'circle' },
        { id: 'pro', name: 'Pro', amount: 4900, pay_to: '0x5631a4d7516da6bc2712f91dc8489637b87e2f52', network: 'circle' },
      ],
    },
  }

  beforeEach(() => vi.clearAllMocks())
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('returns a real offer per plan from core\'s live plans endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => REAL_PLANS_RESPONSE })))
    const offers = await buildX402CrosshostOffers()
    expect(offers.length).toBe(2)
    for (const o of offers) {
      expect(o.method).toBe('x402')
      expect(o.plan_id).toBeTruthy()
      expect(Number(o.amount)).toBeGreaterThan(0)
      expect(o.pay_to).toBeTruthy()
      expect(o.currency).toBe('USDC')
    }
  })

  it('every offer satisfies the real checker\'s required-field validation (amount, pay_to, method)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => REAL_PLANS_RESPONSE })))
    const offers = await buildX402CrosshostOffers()
    const REQUIRED_OFFER_FIELDS = ['amount', 'pay_to', 'method'] as const
    for (const offer of offers) {
      for (const field of REQUIRED_OFFER_FIELDS) {
        expect(Boolean((offer as unknown as Record<string, unknown>)[field])).toBe(true)
      }
    }
  })

  it('returns [] when core is unreachable — never fabricates an offer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    expect(await buildX402CrosshostOffers()).toEqual([])
  })

  it('returns [] on a non-200 response from core', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    expect(await buildX402CrosshostOffers()).toEqual([])
  })

  it('returns [] when the response body is malformed (no plans array)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: {} }) })))
    expect(await buildX402CrosshostOffers()).toEqual([])
  })

  it('skips an individual plan missing a required field rather than fabricating one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { plans: [{ id: 'hobbyist', amount: 500 }, { id: 'pro', amount: 4900, pay_to: '0xabc' }] } }),
    })))
    const offers = await buildX402CrosshostOffers()
    expect(offers.length).toBe(1)
    expect(offers[0].plan_id).toBe('pro')
  })
})

describe('annotateOpenApiWithX402Crosshost', () => {
  function baseSpec() {
    return {
      openapi: '3.1.0',
      servers: [{ url: 'https://api.ainative.studio' }, { url: 'https://builder.ainative.studio' }],
      paths: {
        [X402_CROSSHOST_OPERATION_PATH]: {
          [X402_CROSSHOST_OPERATION_METHOD]: { operationId: 'subscribeViaX402' },
        },
      },
    }
  }

  beforeEach(() => vi.clearAllMocks())
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('leaves the spec untouched when core is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    const result = await annotateOpenApiWithX402Crosshost(baseSpec())
    expect((result.paths[X402_CROSSHOST_OPERATION_PATH] as any)[X402_CROSSHOST_OPERATION_METHOD]['x-payment-info']).toBeUndefined()
  })

  it('adds x-payment-info with real offers on the x402 operation when core is reachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { plans: [{ id: 'hobbyist', name: 'Hobbyist', amount: 500, pay_to: '0xabc', network: 'circle' }] } }),
    })))
    const result = await annotateOpenApiWithX402Crosshost(baseSpec())
    const paymentInfo = (result.paths[X402_CROSSHOST_OPERATION_PATH] as any)[X402_CROSSHOST_OPERATION_METHOD]['x-payment-info']
    expect(paymentInfo.offers.length).toBe(1)
    expect(paymentInfo.offers[0].plan_id).toBe('hobbyist')
    expect(paymentInfo.realm).toBe('api.ainative.studio')
  })

  it('never throws on a malformed/missing paths shape — defensive, total', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: { plans: [{ id: 'x', amount: 1, pay_to: 'y' }] } }) })))
    await expect(annotateOpenApiWithX402Crosshost({})).resolves.not.toThrow()
    await expect(annotateOpenApiWithX402Crosshost({ paths: null })).resolves.not.toThrow()
    await expect(annotateOpenApiWithX402Crosshost(null as any)).resolves.not.toThrow()
  })
})
