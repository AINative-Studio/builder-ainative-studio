import { describe, it, expect } from 'vitest'
import { matchArchetypes, componentsForIdea, componentGuidanceBlock } from '@/lib/build/primitive-graph'

describe('primitive-graph (#83 · Phase 7c)', () => {
  it('a CRM idea traverses to ZeroPipeline + the right components', () => {
    const nodes = matchArchetypes('a CRM to track deals and contacts')
    expect(nodes.some(n => n.key === 'crm')).toBe(true)
    expect(nodes.flatMap(n => n.primitives)).toContain('ZeroPipeline')
    const comps = componentsForIdea('a CRM to track deals')
    expect(comps).toContain('AIKitSidebar')
    expect(comps).toContain('AIKitTable')
  })

  it('an ecommerce idea implies product cards + pagination', () => {
    const comps = componentsForIdea('an online store to sell products with a cart and checkout')
    expect(comps).toContain('AIKitProductCard')
    expect(comps).toContain('AIKitPagination')
  })

  it('a nonprofit idea traverses to AINativeNGO', () => {
    const nodes = matchArchetypes('a nonprofit donation platform for donors and grants')
    expect(nodes.flatMap(n => n.primitives)).toContain('AINativeNGO')
  })

  it('componentGuidanceBlock names concrete components for a matched idea', () => {
    const b = componentGuidanceBlock('a CRM with a contacts table')
    expect(b).toMatch(/COMPONENTS THIS APP NEEDS/)
    expect(b).toContain('<AIKitTable />')
  })

  it('a generic/unmatched idea → empty guidance (keeps defaults)', () => {
    expect(componentGuidanceBlock('a personal haiku generator')).toBe('')
    expect(matchArchetypes('a haiku generator')).toEqual([])
  })

  it('empty idea → no matches', () => {
    expect(matchArchetypes('')).toEqual([])
    expect(componentsForIdea('')).toEqual([])
  })
})
