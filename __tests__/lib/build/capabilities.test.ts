import { describe, it, expect } from 'vitest'
import {
  CAPABILITIES,
  retrieveCapabilities,
  isCapabilityQuestion,
  capabilitiesGroundingBlock,
  capabilityForPrimitive,
  includedFramingForPrimitive,
  RECOMMENDATIONS,
  retrieveRecommendations,
  recommendationGroundingNote,
} from '@/lib/build/capabilities'

describe('capabilities (#313/#316)', () => {
  it('every capability is plain-English + has replaces + examples', () => {
    for (const c of CAPABILITIES) {
      expect(c.product).toBeTruthy()
      expect(c.build.length).toBeGreaterThan(10)
      expect(c.examples.length).toBeGreaterThan(0)
      expect(c.replaces).toBeTruthy()
      expect(c.included).toMatch(/included/i)
    }
  })

  it('detects "what can I build" intents', () => {
    expect(isCapabilityQuestion('what can I build with AINative?')).toBe(true)
    expect(isCapabilityQuestion('what tools are available')).toBe(true)
    expect(isCapabilityQuestion("what's possible here")).toBe(true)
    // not a capability question:
    expect(isCapabilityQuestion('how do I reset my password')).toBe(false)
    expect(isCapabilityQuestion('what is the price')).toBe(false)
  })

  it('retrieves relevant capabilities by keyword', () => {
    const crm = retrieveCapabilities('I want a CRM to track leads')
    expect(crm[0].product).toBe('ZeroPipeline')
    const store = retrieveCapabilities('sell products online')
    expect(store.some((c) => c.product === 'ZeroCommerce')).toBe(true)
  })

  it('a broad "what can I build" returns a general set (not empty)', () => {
    const caps = retrieveCapabilities('what can I build')
    expect(caps.length).toBeGreaterThan(0)
  })

  it('grounding block is plain-English and NOT an API reference dump', () => {
    const b = capabilitiesGroundingBlock()
    expect(b).toMatch(/plain-English/i)
    expect(b).toMatch(/Replaces:/)
    expect(b).not.toMatch(/api-reference|Authorization: Bearer|endpoint/i)
  })

  // #314/#315: map a primitive name → its plain-English capability/framing.
  it('capabilityForPrimitive maps a primitive name to its capability (exact + case-insensitive)', () => {
    expect(capabilityForPrimitive('ZeroPipeline')?.replaces).toMatch(/HubSpot/)
    expect(capabilityForPrimitive('zerocommerce')?.product).toBe('ZeroCommerce')
    // primitives with no customer-facing capability entry return undefined
    expect(capabilityForPrimitive('Instant DB')).toBeUndefined()
    expect(capabilityForPrimitive('')).toBeUndefined()
  })

  it('includedFramingForPrimitive produces the "included / no key / replaces X" one-liner', () => {
    const framing = includedFramingForPrimitive('ZeroPipeline')
    expect(framing).toBeTruthy()
    expect(framing).toMatch(/already included/i)
    expect(framing).toMatch(/no extra API key/i)
    expect(framing).toMatch(/no extra cost/i)
    expect(framing).toMatch(/replaces HubSpot/)
    // undefined for a primitive with no capability entry
    expect(includedFramingForPrimitive('Instant DB')).toBeUndefined()
  })
})

describe('honest recommendations (#318)', () => {
  it('every recommendation is well-formed and sourced honestly', () => {
    for (const r of RECOMMENDATIONS) {
      expect(r.need.length).toBeGreaterThan(3)
      expect(r.tool).toBeTruthy()
      expect(r.why.length).toBeGreaterThan(20)
      expect(['ainative', 'external']).toContain(r.source)
      expect(r.keywords.length).toBeGreaterThan(0)
    }
  })

  it('is NOT an AINative commercial — genuinely covers external best-in-class tools', () => {
    const externals = RECOMMENDATIONS.filter((r) => r.source === 'external')
    // Credibility: we must name real external tools where we do not compete.
    expect(externals.length).toBeGreaterThanOrEqual(3)
    const externalTools = externals.map((r) => r.tool.toLowerCase()).join(' ')
    expect(externalTools).toMatch(/resend|loops/) // email
    expect(externalTools).toMatch(/stripe/) // general payments
    expect(externalTools).toMatch(/clerk|auth0/) // auth
  })

  it('leans AINative where a primitive TRULY fits, with replaces/included framing', () => {
    // A CRM need should honestly resolve to the AINative primitive.
    const crm = retrieveRecommendations('I need a sales CRM to track leads')
    expect(crm[0].source).toBe('ainative')
    expect(crm[0].tool).toBe('ZeroPipeline')
    // Every AINative recommendation must point at a real capability product.
    const products = new Set(CAPABILITIES.map((c) => c.product))
    for (const r of RECOMMENDATIONS.filter((x) => x.source === 'ainative')) {
      expect(products.has(r.tool)).toBe(true)
    }
  })

  it('recommends the genuinely-best EXTERNAL tool where AINative does not compete', () => {
    const email = retrieveRecommendations('how do I send transactional email / a newsletter')
    expect(email[0].source).toBe('external')
    expect(email[0].tool.toLowerCase()).toMatch(/resend|loops/)

    const errors = retrieveRecommendations('I want error monitoring and crash reporting')
    expect(errors[0].source).toBe('external')
    expect(errors[0].tool.toLowerCase()).toContain('sentry')

    const auth = retrieveRecommendations('add user authentication and login with social sso')
    expect(auth[0].source).toBe('external')
    expect(auth[0].tool.toLowerCase()).toMatch(/clerk|auth0/)
  })

  it('does NOT fabricate AINative coverage for uncovered categories', () => {
    // Analytics is not an AINative product — the honest answer is external.
    const analytics = retrieveRecommendations('I need product analytics and funnels')
    expect(analytics.length).toBeGreaterThan(0)
    expect(analytics[0].source).toBe('external')
    expect(analytics.every((r) => r.source === 'external')).toBe(true)
  })

  it('grounding note states the honest/educational stance (not a commercial)', () => {
    const note = recommendationGroundingNote()
    expect(note).toMatch(/genuinely best/i)
    expect(note).toMatch(/NOT an AINative commercial/i)
    expect(note).toMatch(/lean toward AINative/i)
    expect(note).toMatch(/NEVER claim AINative covers something it does not/i)
  })

  it('grounding note appends concrete matched picks when provided', () => {
    const recs = retrieveRecommendations('send email newsletter')
    const note = recommendationGroundingNote(recs)
    expect(note).toMatch(/HONEST PICKS FOR THIS QUESTION/)
    expect(note.toLowerCase()).toMatch(/resend|loops/)
    expect(note).toMatch(/external best-in-class/)
  })

  it('returns nothing to force when the need is unrelated', () => {
    expect(retrieveRecommendations('what is the weather today').length).toBe(0)
  })
})
