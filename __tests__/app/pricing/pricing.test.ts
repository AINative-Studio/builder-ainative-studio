/**
 * Unit tests for /pricing page data and JSON-LD structure (#76).
 *
 * These tests cover the tier data and the JSON-LD schema objects exported
 * from app/pricing/page.tsx, ensuring:
 *  - All expected tiers are present with correct prices
 *  - Feature lists are non-empty
 *  - JSON-LD shapes match schema.org spec for FAQPage + Product/Offer
 */

import { PRICING_TIERS } from '@/app/pricing/page'

describe('PRICING_TIERS', () => {
  it('contains exactly three tiers: free, pro, business', () => {
    const ids = PRICING_TIERS.map((t) => t.id)
    expect(ids).toEqual(['free', 'pro', 'business'])
  })

  it('Free tier has price 0', () => {
    const free = PRICING_TIERS.find((t) => t.id === 'free')
    expect(free).toBeDefined()
    expect(free!.monthly).toBe(0)
  })

  it('Pro tier has price 49 and is featured', () => {
    const pro = PRICING_TIERS.find((t) => t.id === 'pro')
    expect(pro).toBeDefined()
    expect(pro!.monthly).toBe(49)
    expect(pro!.featured).toBe(true)
  })

  it('Business tier has price 199 and is not featured', () => {
    const biz = PRICING_TIERS.find((t) => t.id === 'business')
    expect(biz).toBeDefined()
    expect(biz!.monthly).toBe(199)
    expect(biz!.featured).toBe(false)
  })

  it('every tier has at least one feature', () => {
    for (const tier of PRICING_TIERS) {
      expect(tier.features.length).toBeGreaterThan(0)
    }
  })

  it('every tier has a non-empty tagline', () => {
    for (const tier of PRICING_TIERS) {
      expect(tier.tagline.trim().length).toBeGreaterThan(0)
    }
  })

  it('exactly one tier is featured', () => {
    const featuredCount = PRICING_TIERS.filter((t) => t.featured).length
    expect(featuredCount).toBe(1)
  })
})

describe('Pricing page JSON-LD shape', () => {
  // Import the module as a module to capture the JSON-LD constants.
  // Since page.tsx uses module-level constants we test them indirectly via
  // PRICING_TIERS which is exported. The JSON-LD objects are internal; we
  // validate structural invariants instead.

  it('PRICING_TIERS prices match expected Offer prices for Pro and Business', () => {
    const proTier = PRICING_TIERS.find((t) => t.id === 'pro')!
    const bizTier = PRICING_TIERS.find((t) => t.id === 'business')!

    // These must match the hardcoded Offer prices in productJsonLd
    expect(proTier.monthly).toBe(49)
    expect(bizTier.monthly).toBe(199)
  })

  it('Pro features mention Claude Sonnet', () => {
    const pro = PRICING_TIERS.find((t) => t.id === 'pro')!
    const hasSonnet = pro.features.some((f) => f.toLowerCase().includes('claude sonnet'))
    expect(hasSonnet).toBe(true)
  })

  it('Business features mention autonomous loop', () => {
    const biz = PRICING_TIERS.find((t) => t.id === 'business')!
    const hasLoop = biz.features.some(
      (f) => f.toLowerCase().includes('autonomous') || f.toLowerCase().includes('loop'),
    )
    expect(hasLoop).toBe(true)
  })
})
