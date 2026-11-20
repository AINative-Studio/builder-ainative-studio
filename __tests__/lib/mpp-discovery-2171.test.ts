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
  MPP_PAID_OPERATION_PATH,
  MPP_PAID_OPERATION_METHOD,
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
    }
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
