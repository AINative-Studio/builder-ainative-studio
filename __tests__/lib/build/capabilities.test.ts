import { describe, it, expect } from 'vitest'
import {
  CAPABILITIES,
  retrieveCapabilities,
  isCapabilityQuestion,
  capabilitiesGroundingBlock,
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
})
