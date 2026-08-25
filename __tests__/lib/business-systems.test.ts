import { describe, it, expect } from 'vitest'
import { buildSystems, SAVINGS_BY_PRIMITIVE } from '@/lib/build/business-systems'

describe('business-systems savings (#dashboard-ux)', () => {
  it('attaches vsProvider + savedMonthly for primitives with a comparable', () => {
    // A CRM idea surfaces ZeroPipeline, which maps to Salesforce.
    const s = buildSystems('B2B SaaS sales pipeline CRM for enterprise deals')
    const crm = s.find((x) => x.primitive === 'ZeroPipeline')
    expect(crm).toBeDefined()
    expect(crm?.vsProvider).toBe('Salesforce')
    expect(crm?.savedMonthly).toBeGreaterThan(0)
  })

  it('every SAVINGS_BY_PRIMITIVE entry has a provider name and a positive price', () => {
    for (const [prim, v] of Object.entries(SAVINGS_BY_PRIMITIVE)) {
      expect(v.vsProvider, prim).toBeTruthy()
      expect(v.monthly, prim).toBeGreaterThan(0)
    }
  })

  it('systems without a comparable have undefined savings (never a fake number)', () => {
    const s = buildSystems('a social app for teens with groups and feeds')
    for (const x of s) {
      const known = SAVINGS_BY_PRIMITIVE[x.primitive]
      if (known) {
        expect(x.savedMonthly).toBe(known.monthly)
        expect(x.vsProvider).toBe(known.vsProvider)
      } else {
        expect(x.savedMonthly).toBeUndefined()
        expect(x.vsProvider).toBeUndefined()
      }
    }
  })
})

describe('business-systems (#233, #288, #278)', () => {
  it('returns systems with real primitive names — idea-driven selection', () => {
    const s = buildSystems()
    // Zero-idea call still returns systems (defaults to most-useful primitives)
    expect(s.length).toBeGreaterThan(0)
    expect(s.length).toBeLessThanOrEqual(4)
    // Every system should have a primitive name and docUrl
    for (const x of s) {
      expect(typeof x.primitive).toBe('string')
      expect(x.primitive.length).toBeGreaterThan(0)
      expect(x.docUrl).toMatch(/^https:\/\//)
    }
  })

  it('selects ZeroPipeline for a B2B sales idea', () => {
    const s = buildSystems('B2B SaaS sales pipeline CRM for enterprise deals')
    const prim = s.find((x) => x.primitive === 'ZeroPipeline')
    expect(prim).toBeDefined()
  })

  it('selects ZeroCommerce for an ecommerce idea', () => {
    const s = buildSystems('online coffee shop selling specialty beans and merch')
    const prim = s.find((x) => x.primitive === 'ZeroCommerce')
    expect(prim).toBeDefined()
  })

  it('selects OpenCapStack for a fundraising idea', () => {
    const s = buildSystems('startup equity management cap table and fundraising SAFE notes')
    const prim = s.find((x) => x.primitive === 'OpenCapStack')
    expect(prim).toBeDefined()
  })

  it('shows honest zero-state for a fresh company', () => {
    const s = buildSystems()
    expect(s.every((x) => x.count === 0)).toBe(true)
  })

  it('reflects real counts when the company has data (ZeroPipeline)', () => {
    const s = buildSystems('B2B sales CRM pipeline deals', {
      pipeline: { count: 5, value: 86000 },
    })
    const prim = s.find((x) => x.primitive === 'ZeroPipeline')
    expect(prim).toBeDefined()
    expect(prim!.stat).toMatch(/5 open/)
    expect(prim!.stat).toMatch(/\$86k/)
  })

  it('reflects real counts when the company has data (ZeroInvoice)', () => {
    const s = buildSystems('invoicing billing B2B', {
      invoices: { count: 3, value: 4200 },
    })
    const prim = s.find((x) => x.primitive === 'ZeroInvoice')
    expect(prim).toBeDefined()
    expect(prim!.stat).toMatch(/\$4\.2k collected/)
  })

  it('card url is undefined (non-navigating) for unprovisioned systems (#278)', () => {
    const s = buildSystems('B2B sales CRM pipeline')
    // Without instanceUrls, url should be undefined — never a marketing site
    for (const x of s) {
      expect(x.url).toBeUndefined()
    }
  })

  it('card url is set when an instance URL is provided (#278)', () => {
    const instanceUrls = { ZeroPipeline: 'https://acme.ainative.studio/pipeline' }
    const s = buildSystems('B2B sales CRM pipeline deals', {}, { instanceUrls })
    const prim = s.find((x) => x.primitive === 'ZeroPipeline')
    expect(prim?.url).toBe('https://acme.ainative.studio/pipeline')
  })
})
