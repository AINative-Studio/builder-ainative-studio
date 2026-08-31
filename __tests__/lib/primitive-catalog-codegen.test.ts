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
    // #298: never hardcode a secret; the app runs client-side so it uses the
    // same-origin /api/db proxy, NOT a Bearer key (those endpoints are server-side).
    expect(block).toMatch(/NEVER put a Bearer key or secret/i)
    expect(block).toContain('/api/db/')
  })

  it('every app gets the foundational ZeroDB + auth wiring by default (#298)', () => {
    // Even a non-matching idea must get the /api/db data layer + auth pattern.
    const block = codegenCompositionBlock('a personal habit tracker', 'app')
    expect(block).toMatch(/FOUNDATION — ALWAYS WIRE THESE/i)
    expect(block).toContain('/api/db/{table}')
    expect(block).toMatch(/localStorage/i) // the lightweight auth pattern
  })

  it('foundation block includes the semantic-search pattern (#317)', () => {
    const block = codegenCompositionBlock('an app to search my notes', 'app')
    expect(block).toContain('/api/db/{table}?search=')
    expect(block).toMatch(/SEMANTIC search/)
    // steers away from hand-rolled client-side filtering
    expect(block).toMatch(/do NOT hand-roll client-side text filtering/i)
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

  it('nonprofit idea wires AINativeNGO (InstitutionOS), not OpenCapStack (#302)', () => {
    const block = codegenCompositionBlock('a nonprofit donation platform to manage donors, grants, and impact reporting', 'company')
    expect(block).toContain('AINativeNGO')
    expect(block).toContain('https://ngo.ainative.studio/api/v1')
    // Nonprofit fundraising must NOT be confused with startup-equity fundraising.
    expect(block).not.toContain('OpenCapStack')
  })

  it('startup-equity fundraising still wires OpenCapStack, not AINativeNGO (#302)', () => {
    const block = codegenCompositionBlock('a startup cap table to manage SAFEs, investors, and vesting', 'company')
    expect(block).toContain('OpenCapStack')
    expect(block).not.toContain('AINativeNGO')
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

  // #314/#315: surface the "already included, no extra key/cost, replaces X" framing
  // in the codegen composition path.
  it('CRM idea composition carries the included/replaces framing on ZeroPipeline', () => {
    const block = codegenCompositionBlock('a B2B sales CRM to track deals and leads', 'company')
    expect(block).toContain('ZeroPipeline')
    // plain-English "already included, no extra key/cost" framing
    expect(block).toMatch(/included/i)
    expect(block).toMatch(/no extra API key/i)
    expect(block).toMatch(/no extra cost/i)
    // plain-English "replaces {commercial tool}" (#315)
    expect(block).toMatch(/replaces/i)
    expect(block).toMatch(/HubSpot/)
  })

  it('commerce idea carries "replaces Shopify" included framing', () => {
    const block = codegenCompositionBlock('an online store selling coffee', 'company')
    expect(block).toContain('ZeroCommerce')
    expect(block).toMatch(/replaces/i)
    expect(block).toMatch(/Shopify/)
    expect(block).toMatch(/no extra API key/i)
  })

  it('instructs the model to surface the included/replaces framing to the user', () => {
    const block = codegenCompositionBlock('an invoicing app that bills clients', 'company')
    // The prompt tells the model to surface "built-in / no extra key / replaces X".
    expect(block).toMatch(/built-in|already have|already included/i)
    expect(block).toMatch(/Surface that to the user/i)
    // and not to send the user to the commercial tool it replaces
    expect(block).toMatch(/Do NOT tell the user to sign up/i)
  })
})

// #410 — 7 confirmed-real AINative primitives previously missing from the
// catalog entirely (ZeroCRM, ZeroERP, ZeroForms, ZeroBooks, AgentFlow, QNN
// API, SpaceTime OS). Real apiBase for each verified against the live service
// (see #410's issue comments for the verification trail) — not guessed.
describe('primitive-catalog additions (#410)', () => {
  it('registers all 7 previously-missing primitives with real apiBase values', () => {
    expect(getPrimitive('ZeroCRM')?.apiBase).toBe('https://zerocrm-production.up.railway.app/api/v1')
    expect(getPrimitive('ZeroERP')?.apiBase).toBe('https://zeroerp-production.up.railway.app/api/v1')
    expect(getPrimitive('ZeroForms')?.apiBase).toBe('https://zeroforms-production.up.railway.app/api/v1')
    expect(getPrimitive('ZeroBooks')?.apiBase).toBe('https://zerobooks-production.up.railway.app/api/v1')
    // AgentFlow's real prefix (confirmed via its own live openapi.json) is
    // /api/v1/build, not the generic /api/v1 most AINative services use.
    expect(getPrimitive('AgentFlow')?.apiBase).toBe('https://agentflow.ainative.studio/api/v1/build')
    expect(getPrimitive('QNN API')?.apiBase).toBe('https://qnn.ainative.studio/api/v1')
    // #425: the original "SpaceTime OS" entry actually pointed at Ocean (an
    // unrelated knowledge-base primitive) — split into two correctly-identified
    // entries. Real SpaceTime OS / Sentinel OS is its own service.
    expect(getPrimitive('Ocean')?.apiBase).toBe('https://oceanapi.ainative.studio/api/v1')
    expect(getPrimitive('SpaceTime OS')?.apiBase).toBe('https://sentinel-os-api-production.up.railway.app/api/v1')
  })

  it('ZeroCRM is distinct from ZeroPipeline, not a duplicate/rename', () => {
    const crm = getPrimitive('ZeroCRM')
    const pipeline = getPrimitive('ZeroPipeline')
    expect(crm?.apiBase).not.toBe(pipeline?.apiBase)
    expect(crm?.purpose).not.toBe(pipeline?.purpose)
  })

  it('none of the 7 additions collide with an existing catalog name', () => {
    const names = CATALOG.map((p) => p.name)
    const added = ['ZeroCRM', 'ZeroERP', 'ZeroForms', 'ZeroBooks', 'AgentFlow', 'QNN API', 'SpaceTime OS', 'Ocean']
    for (const name of added) {
      expect(names.filter((n) => n === name)).toHaveLength(1)
    }
  })

  it('a forms/survey idea composition surfaces ZeroForms', () => {
    const sel = selectPrimitives('a customer intake survey with webhook notifications', 'app')
    expect(sel.names).toContain('ZeroForms')
  })

  it('a bookkeeping idea composition surfaces ZeroBooks', () => {
    const sel = selectPrimitives('an app that tracks expenses and chart of accounts', 'company')
    expect(sel.names).toContain('ZeroBooks')
  })
})
