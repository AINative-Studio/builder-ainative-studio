/**
 * Unit tests for lib/build/proposal.ts (#68) — the pay-gate proposal logic.
 *
 * Covers every exported function and branch:
 *   - toProposedSystems (catalog enrichment + fallback purpose)
 *   - systemPreview (templated + generic fallback)
 *   - buildProposal (named/anonymous company, empty idea, plan cost line, cap)
 *   - proposalStatusCounts (live/planned/total)
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest'
import {
  toProposedSystems,
  systemPreview,
  buildProposal,
  proposalStatusCounts,
  type ProposedSystem,
  type ProposalPlan,
} from '@/lib/build/proposal'
import type { BusinessSystem } from '@/lib/build/business-systems'

const PLAN: ProposalPlan = { id: 'pro', name: 'Pro', monthly: 49 }

// ---------------------------------------------------------------------------
// toProposedSystems
// ---------------------------------------------------------------------------

describe('toProposedSystems', () => {
  it('enriches a known primitive with its catalog purpose as "what it does"', () => {
    const systems: BusinessSystem[] = [
      { key: 'zeroinvoice', name: 'ZeroInvoice', primitive: 'ZeroInvoice', docUrl: 'https://d/z', stat: 'Ready · $0 collected', count: 0, provisioned: false },
    ]
    const [p] = toProposedSystems(systems)
    expect(p.name).toBe('ZeroInvoice')
    expect(p.whatItDoes).toMatch(/invoic/i)
    expect(p.whatItDoes.length).toBeGreaterThan(0)
    expect(p.provisioned).toBe(false)
    expect(p.stat).toBe('Ready · $0 collected')
    expect(p.docUrl).toBe('https://d/z')
  })

  it('coerces a missing provisioned flag to a boolean false', () => {
    const systems: BusinessSystem[] = [
      { key: 'x', name: 'ZeroPipeline', primitive: 'ZeroPipeline', docUrl: 'd', stat: 's', count: 0 },
    ]
    const [p] = toProposedSystems(systems)
    expect(p.provisioned).toBe(false)
  })

  it('preserves a true provisioned flag', () => {
    const systems: BusinessSystem[] = [
      { key: 'x', name: 'ZeroPipeline', primitive: 'ZeroPipeline', docUrl: 'd', stat: 's', count: 3, provisioned: true },
    ]
    const [p] = toProposedSystems(systems)
    expect(p.provisioned).toBe(true)
  })

  it('falls back to generic copy when the primitive is not in the catalog', () => {
    const systems: BusinessSystem[] = [
      { key: 'nope', name: 'Nonexistent', primitive: 'Nonexistent', docUrl: 'd', stat: 's', count: 0, provisioned: false },
    ]
    const [p] = toProposedSystems(systems)
    expect(p.whatItDoes).toBe('A business system Cody wires for your company.')
  })

  it('maps an empty list to an empty list', () => {
    expect(toProposedSystems([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// systemPreview
// ---------------------------------------------------------------------------

const makeProposed = (over: Partial<ProposedSystem> = {}): ProposedSystem => ({
  key: 'zeroinvoice',
  name: 'ZeroInvoice',
  primitive: 'ZeroInvoice',
  whatItDoes: 'Invoicing + billing',
  stat: 'Ready · $0 collected',
  docUrl: 'd',
  provisioned: false,
  ...over,
})

describe('systemPreview', () => {
  it('returns the templated preview for a known primitive', () => {
    const pv = systemPreview(makeProposed())
    expect(pv.title).toBe('Invoices & billing')
    expect(pv.columns).toEqual(['Invoice', 'Customer', 'Status'])
    expect(pv.rows.length).toBeGreaterThan(0)
    // every row aligns to the column count
    for (const row of pv.rows) expect(row).toHaveLength(pv.columns.length)
    expect(pv.note).toContain('ZeroInvoice')
  })

  it('templates each business-ops primitive with aligned columns/rows', () => {
    const names = [
      'ZeroPipeline', 'ZeroInvoice', 'ZeroCommerce', 'ServiceOS', 'ZeroVoice',
      'OpenCapStack', 'Content Workflow', 'Live Streaming',
      'Intent-Casting Marketplace', 'Browser Agent',
    ]
    for (const primitive of names) {
      const pv = systemPreview(makeProposed({ primitive, name: primitive, key: primitive.toLowerCase() }))
      expect(pv.columns.length).toBeGreaterThanOrEqual(2)
      expect(pv.rows.length).toBeGreaterThan(0)
      for (const row of pv.rows) expect(row).toHaveLength(pv.columns.length)
    }
  })

  it('returns a concrete generic preview (never blank) for an unknown primitive', () => {
    const pv = systemPreview(makeProposed({ primitive: 'Whatsit', name: 'Whatsit', key: 'whatsit', whatItDoes: 'Does a thing' }))
    expect(pv.title).toBe('Whatsit')
    expect(pv.subtitle).toBe('Does a thing')
    expect(pv.columns).toEqual(['Item', 'Detail', 'Status'])
    expect(pv.rows.length).toBeGreaterThan(0)
    for (const row of pv.rows) expect(row).toHaveLength(pv.columns.length)
    expect(pv.note).toContain('Whatsit')
  })
})

// ---------------------------------------------------------------------------
// buildProposal
// ---------------------------------------------------------------------------

describe('buildProposal', () => {
  it('builds a proposal with idea-driven systems for a named company', () => {
    const p = buildProposal({ companyName: 'Riff', idea: 'invoicing and billing for freelancers', plan: PLAN })
    expect(p.companyName).toBe('Riff')
    expect(p.systems.length).toBeGreaterThan(0)
    expect(p.systems.length).toBeLessThanOrEqual(4)
    expect(p.headline).toContain('Riff')
    expect(p.recommendedTier).toBe('pro')
    // each proposed system carries what-it-does copy
    for (const s of p.systems) expect(s.whatItDoes.length).toBeGreaterThan(0)
  })

  it('selects invoicing when the idea is about getting paid', () => {
    const p = buildProposal({ companyName: 'Bill Co', idea: 'send invoices and get paid by customers', plan: PLAN })
    expect(p.systems.some((s) => s.primitive === 'ZeroInvoice')).toBe(true)
  })

  it('uses generic copy and a fallback name when no company name is given', () => {
    const p = buildProposal({ idea: 'a coffee brand selling beans online', plan: PLAN })
    expect(p.companyName).toBe('')
    expect(p.headline).toBe('You’ve seen it work. Here’s what Cody builds next.')
    expect(p.subline).toContain('your company')
  })

  it('trims whitespace-only company names to empty', () => {
    const p = buildProposal({ companyName: '   ', idea: 'crm sales pipeline', plan: PLAN })
    expect(p.companyName).toBe('')
  })

  it('still returns systems for an empty idea (sensible defaults)', () => {
    const p = buildProposal({ companyName: 'Blank', idea: '', plan: PLAN })
    expect(p.systems.length).toBeGreaterThan(0)
    expect(p.subline).toContain('Blank')
  })

  it('builds the cost line from the recommended plan', () => {
    const p = buildProposal({ companyName: 'Riff', idea: 'crm', plan: { id: 'business', name: 'Business', monthly: 149 } })
    expect(p.costLine).toContain('Business')
    expect(p.costLine).toContain('$149/mo')
    expect(p.recommendedTier).toBe('business')
  })

  it('honors the maxSystems cap', () => {
    const p = buildProposal({ companyName: 'Riff', idea: 'crm sales invoicing helpdesk voice commerce', plan: PLAN, maxSystems: 2 })
    expect(p.systems.length).toBeLessThanOrEqual(2)
  })

  it('defaults maxSystems to 4', () => {
    const p = buildProposal({ companyName: 'Riff', idea: 'crm sales invoicing helpdesk voice commerce equity content streaming', plan: PLAN })
    expect(p.systems.length).toBeLessThanOrEqual(4)
  })

  it('produces a singular subline when only one system is proposed', () => {
    const p = buildProposal({ companyName: 'Solo', idea: 'crm', plan: PLAN, maxSystems: 1 })
    expect(p.systems.length).toBe(1)
    expect(p.subline).toContain('1 business system')
    expect(p.subline).not.toContain('1 business systems')
  })
})

// ---------------------------------------------------------------------------
// proposalStatusCounts
// ---------------------------------------------------------------------------

describe('proposalStatusCounts', () => {
  it('counts all planned when nothing is provisioned', () => {
    const systems = [makeProposed(), makeProposed({ key: 'b' }), makeProposed({ key: 'c' })]
    expect(proposalStatusCounts(systems)).toEqual({ live: 0, planned: 3, total: 3 })
  })

  it('counts live vs planned correctly in a mix', () => {
    const systems = [
      makeProposed({ key: 'a', provisioned: true }),
      makeProposed({ key: 'b', provisioned: false }),
      makeProposed({ key: 'c', provisioned: true }),
    ]
    expect(proposalStatusCounts(systems)).toEqual({ live: 2, planned: 1, total: 3 })
  })

  it('returns zeros for an empty list', () => {
    expect(proposalStatusCounts([])).toEqual({ live: 0, planned: 0, total: 0 })
  })
})
