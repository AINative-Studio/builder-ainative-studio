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

  it('coffee brand codegen prompt wires ZeroCommerce via the real runtime proxy, not a hand-rolled cart', () => {
    const block = codegenCompositionBlock('an artisan coffee brand that sells beans online', 'company')
    // Composition intent
    expect(block).toContain('COMPOSE WITH REAL AINATIVE PRIMITIVES')
    expect(block).toMatch(/do NOT re-implement business logic/i)
    // ZeroCommerce present for a commerce idea, wired through its real runtime
    // proxy (#443) — NOT the raw external apiBase (a direct client fetch to
    // that host is guaranteed to fail; see RUNTIME_PROXIED_PRIMITIVES's doc).
    expect(block).toContain('ZeroCommerce')
    expect(block).toContain('/api/primitive/zerocommerce/')
    expect(block).not.toContain('https://zerocommerce.ainative.studio/api/v1')
    // Explicit instruction not to hand-roll checkout/cart
    expect(block).toMatch(/checkout/i)
    // #298: never hardcode a secret; the app runs client-side so it uses the
    // same-origin /api/db proxy, NOT a Bearer key (those endpoints are server-side).
    expect(block).toMatch(/NEVER put a Bearer key or secret/i)
    expect(block).toContain('/api/db/')
  })

  it('#443: ZeroCommerce is instructed to use the credential-free same-origin proxy, mirroring how /api/db needs no key from the app', () => {
    const block = codegenCompositionBlock('an artisan coffee brand that sells beans online', 'company')
    expect(block).toMatch(/ZeroCommerce[^\n]*To use: call the same-origin proxy at `\/api\/primitive\/zerocommerce\//)
    expect(block).toMatch(/ZeroCommerce[^\n]*NO Authorization header needed/)
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
    // Real live route is /v1/* (no /api prefix) — confirmed via live probe
    // (#421): /api/v1/forms 404s, /v1/forms correctly 401s with "Invalid or
    // unauthorized AINative API key".
    expect(getPrimitive('ZeroForms')?.apiBase).toBe('https://zeroforms-production.up.railway.app/v1')
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

  describe('honest runtime-path framing (found via live stress-test of the build workflow)', () => {
    // Live infra + source investigation confirmed generated app code has NO
    // real way to call a non-ZeroDB primitive directly: no browser bundle
    // ever carries AINATIVE_API_KEY, and several primitives (ZeroCommerce,
    // ZeroPipeline, AgentFlow, ZeroForms) provision "one resource per owner
    // user" — scoped to the FOUNDER's identity, not a durable per-company
    // service credential builder could proxy even with a generic route. The
    // prompt must never instruct a direct fetch() to these; it must say the
    // capability was already set up server-side instead.

    it('only ZeroDB and Instant DB get a literal fetch()-with-Bearer instruction', () => {
      const block = codegenCompositionBlock('an inventory and warehouse tool for a small manufacturer', 'company')
      // ZeroDB/Instant DB: real browser-callable path (via /api/db), so the
      // literal REST-call instruction is honest here.
      expect(block).toMatch(/ZeroDB[^\n]*To use: call its REST API at `https:\/\/api\.ainative\.studio\/api\/v1`/)
      expect(block).toMatch(/Instant DB[^\n]*To use: call its REST API at/)
    })

    it('ZeroERP (no browser-callable proxy) is framed as already-provisioned, not a direct fetch target', () => {
      const block = codegenCompositionBlock('an inventory and warehouse tool for a small manufacturer', 'company')
      expect(block).toContain('ZeroERP')
      // Must NOT tell the model to call ZeroERP's real host directly.
      expect(block).not.toMatch(/ZeroERP[^\n]*To use: call its REST API/)
      expect(block).toMatch(/ZeroERP[^\n]*already provisioned for this company server-side/)
    })

    it('ZeroPipeline/AgentFlow/ZeroForms (founder-scoped, no proxy wired yet) are framed the honest "already provisioned" way', () => {
      const pipeline = codegenCompositionBlock('a B2B sales CRM to track deals', 'company')
      expect(pipeline).not.toMatch(/ZeroPipeline[^\n]*To use: call its REST API/)
      expect(pipeline).toMatch(/ZeroPipeline[^\n]*already provisioned for this company server-side/)

      const forms = codegenCompositionBlock('a customer intake survey with webhook notifications', 'app')
      expect(forms).not.toMatch(/ZeroForms[^\n]*To use: call its REST API/)
      expect(forms).toMatch(/ZeroForms[^\n]*already provisioned for this company server-side/)
    })

    it('rule 2 no longer claims non-ZeroDB primitives are called "server-side by the platform" (no such proxy exists)', () => {
      const block = codegenCompositionBlock('a customer support helpdesk with tickets', 'company')
      // The old, misleading claim must be gone.
      expect(block).not.toMatch(/SaaS primitive endpoints listed above are called SERVER-SIDE only \(by the platform\)/)
      // The honest replacement must be present.
      expect(block).toMatch(/NEVER fetch\(\) a primitive's apiBase directly unless this block explicitly said to/)
    })

    it('never instructs the model to fetch a non-proxied primitive even when it is the only match', () => {
      // ServiceOS has no provisioning step at all (access is implicit via the
      // founder's JWT) and is not in RUNTIME_PROXIED_PRIMITIVES — a generated
      // app still cannot call it directly (no JWT in the browser bundle).
      const block = codegenCompositionBlock('a customer support helpdesk with tickets', 'company')
      expect(block).toContain('ServiceOS')
      expect(block).not.toMatch(/ServiceOS[^\n]*To use: call its REST API/)
    })
  })

  describe('OpenCapStack is real, unconditional company substrate (#427 always provisions it)', () => {
    it('appears for a company-track idea with zero equity/cap-table language', () => {
      const { names, foundational } = selectPrimitives('a coffee shop loyalty rewards app', 'company')
      expect(names).toContain('OpenCapStack')
      expect(foundational.map((p) => p.name)).toContain('OpenCapStack')
    })

    it('does NOT appear on the app track for the same idea (no auto-provisioning there)', () => {
      const { names } = selectPrimitives('a coffee shop loyalty rewards app', 'app')
      expect(names).not.toContain('OpenCapStack')
    })

    it('a nonprofit idea still gets AINativeNGO instead, not OpenCapStack (#302 carve-out preserved)', () => {
      const { names } = selectPrimitives('a nonprofit donation platform to manage donors, grants, and impact reporting', 'company')
      expect(names).toContain('AINativeNGO')
      expect(names).not.toContain('OpenCapStack')
    })

    it('an explicit equity idea still gets OpenCapStack (unaffected by the nonprofit carve-out)', () => {
      const { names } = selectPrimitives('a startup cap table and equity management tool', 'company')
      expect(names).toContain('OpenCapStack')
      expect(names).not.toContain('AINativeNGO')
    })

    it('is framed as already-provisioned server-side, not a direct-fetch target (not in RUNTIME_PROXIED_PRIMITIVES)', () => {
      const block = codegenCompositionBlock('a coffee shop loyalty rewards app', 'company')
      expect(block).toContain('OpenCapStack')
      expect(block).not.toMatch(/OpenCapStack[^\n]*To use: call its REST API/)
      expect(block).toMatch(/OpenCapStack[^\n]*already provisioned for this company server-side/)
    })
  })
})
