import { describe, it, expect } from 'vitest'
import {
  codegenCompositionBlock,
  selectPrimitives,
  catalogPromptBlock,
  CATALOG,
  CATALOG_SIZE,
  getPrimitive,
} from '@/lib/build/primitive-catalog'

describe('primitive-catalog codegen composition (#218)', () => {
  it('does not break the existing #288 selection exports', () => {
    // Guard: other code (business-systems, PoweringThis, ask, backlog) depends on these.
    expect(typeof selectPrimitives).toBe('function')
    expect(typeof catalogPromptBlock).toBe('function')
    expect(Array.isArray(CATALOG)).toBe(true)
    expect(CATALOG_SIZE).toBe(CATALOG.length)
    const sel = selectPrimitives('a coffee brand storefront', 'company')
    expect(sel.names).toContain('ZeroCommerce')
  })

  it('enriches business-ops primitives with real base API URLs (additive)', () => {
    const commerce = getPrimitive('ZeroCommerce')
    expect(commerce?.apiBase).toBe('https://zerocommerce.ainative.studio/api/v1')
    const invoice = getPrimitive('ZeroInvoice')
    expect(invoice?.apiBase).toBe('https://zeroinvoice.ainative.studio/api')
    const pipeline = getPrimitive('ZeroPipeline')
    expect(pipeline?.apiBase).toBe('https://pipeline.ainative.studio/api/v1')
    // AI Kit is SDK-only (no REST base), Browser Agent is MCP/SDK-only.
    expect(getPrimitive('AI Kit')?.sdk).toBe('@ainative/ai-kit-core')
    expect(getPrimitive('Browser Agent')?.sdk).toBe('@ainative/browser-mcp')
  })

  it('coffee brand codegen prompt wires ZeroCommerce real endpoint, not a hand-rolled cart', () => {
    const block = codegenCompositionBlock('an artisan coffee brand that sells beans online', 'company')
    // Composition intent
    expect(block).toContain('COMPOSE WITH REAL AINATIVE PRIMITIVES')
    expect(block).toMatch(/do NOT re-implement business logic/i)
    // Real ZeroCommerce endpoint present for a commerce idea
    expect(block).toContain('ZeroCommerce')
    expect(block).toContain('https://zerocommerce.ainative.studio/api/v1')
    // Explicit instruction not to hand-roll checkout/cart
    expect(block).toMatch(/checkout/i)
    // Bearer auth from env, never hardcoded
    expect(block).toContain('AINATIVE_API_KEY')
    expect(block).toMatch(/NEVER hardcode/i)
  })

  it('B2B SaaS idea wires ZeroPipeline (CRM) real endpoint', () => {
    const block = codegenCompositionBlock('a B2B sales CRM to track deals and leads', 'company')
    expect(block).toContain('ZeroPipeline')
    expect(block).toContain('https://pipeline.ainative.studio/api/v1')
  })

  it('invoicing idea wires ZeroInvoice real endpoint', () => {
    const block = codegenCompositionBlock('an invoicing app that bills clients and gets paid', 'company')
    expect(block).toContain('ZeroInvoice')
    expect(block).toContain('https://zeroinvoice.ainative.studio/api')
  })

  it('always steers toward AI Kit + ZeroDB even when no business-ops primitive matches', () => {
    const block = codegenCompositionBlock('xyzzy plugh nonsense idea', 'company')
    expect(block).toContain('@ainative/ai-kit-core')
    expect(block).toContain('https://api.ainative.studio/api/v1') // ZeroDB base
  })

  it('produces materially different wiring for different ideas', () => {
    const coffee = codegenCompositionBlock('coffee ecommerce store', 'company')
    const crm = codegenCompositionBlock('sales pipeline CRM', 'company')
    expect(coffee).toContain('ZeroCommerce')
    expect(coffee).not.toContain('https://pipeline.ainative.studio/api/v1')
    expect(crm).toContain('ZeroPipeline')
    expect(crm).not.toContain('https://zerocommerce.ainative.studio/api/v1')
  })
})
