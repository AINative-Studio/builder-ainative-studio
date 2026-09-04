import { describe, it, expect } from 'vitest'
import {
  codegenCompositionBlock,
  selectPrimitives,
  catalogPromptBlock,
  CATALOG,
  CATALOG_SIZE,
  getPrimitive,
  RUNTIME_PROXY_PATH_SUBSTRINGS,
  getRuntimeProxyInstruction,
  getComplianceCheckedPrimitiveNames,
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

  it('B2B SaaS idea wires ZeroPipeline (CRM) via its real same-origin runtime proxy (#443)', () => {
    const block = codegenCompositionBlock('a B2B sales CRM to track deals and leads', 'company')
    expect(block).toContain('ZeroPipeline')
    // ZeroPipeline is founder-identity-scoped (#443) — the generated app calls
    // the same-origin proxy, never ZeroPipeline's real host directly.
    expect(block).toContain('/api/primitive/zeropipeline/')
    expect(block).not.toContain('https://pipeline.ainative.studio/api/v1')
  })

  it('invoicing idea wires ZeroInvoice real endpoint', () => {
    const block = codegenCompositionBlock('an invoicing app that bills clients and gets paid', 'company')
    expect(block).toContain('ZeroInvoice')
    expect(block).toContain('https://zeroinvoice.ainative.studio/api')
  })

  it('nonprofit idea wires AINativeNGO (InstitutionOS) as a real direct-fetch target, not OpenCapStack (#302, #510)', () => {
    const block = codegenCompositionBlock('a nonprofit donation platform to manage donors, grants, and impact reporting', 'company')
    expect(block).toContain('AINativeNGO')
    expect(block).toMatch(/AINativeNGO[^\n]*GET \/api\/ainative-ngo\/institutions/)
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
    // Re-verified (#443 follow-up): AgentFlow's real prefix is the plain
    // /api/v1 (confirmed via a real POST to /api/v1/projects/ returning a
    // structured FastAPI auth-reject body). The original #410 claim of a
    // /build prefix was wrong — that path only 200s because it falls
    // through to the SPA's HTML shell, not a real API route.
    expect(getPrimitive('AgentFlow')?.apiBase).toBe('https://agentflow.ainative.studio/api/v1')
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

    it('ZeroPipeline (#443 follow-up: real proxy shipped) now gets a real same-origin proxy instruction, not the placeholder', () => {
      const block = codegenCompositionBlock('a B2B sales CRM to track deals', 'company')
      expect(block).toContain('ZeroPipeline')
      expect(block).not.toMatch(/ZeroPipeline[^\n]*already provisioned for this company server-side/)
      expect(block).toMatch(/ZeroPipeline[^\n]*To use: call the same-origin proxy at `\/api\/primitive\/zeropipeline\//)
      expect(block).toMatch(/ZeroPipeline[^\n]*NO Authorization header needed/)
    })

    it('ZeroForms (#443 follow-up: real proxy shipped, last of the 4 founder-scoped primitives) now gets a real same-origin proxy instruction', () => {
      // ZeroForms provisioning is company-track only (checkout provisions the
      // default form) — use 'company' to match what's actually provisioned.
      const block = codegenCompositionBlock('a customer intake survey with webhook notifications', 'company')
      expect(block).toContain('ZeroForms')
      expect(block).not.toMatch(/ZeroForms[^\n]*already provisioned for this company server-side/)
      expect(block).toMatch(/ZeroForms[^\n]*To use: call the same-origin proxy at `\/api\/primitive\/zeroforms\//)
      expect(block).toMatch(/ZeroForms[^\n]*NO Authorization header needed/)
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

    it('AgentFlow now gets a real same-origin proxy instruction, not the honest-placeholder framing (#443 follow-up)', () => {
      const block = codegenCompositionBlock('a no-code visual agent workflow builder', 'company')
      expect(block).toContain('AgentFlow')
      expect(block).not.toMatch(/AgentFlow[^\n]*already provisioned for this company server-side/)
      expect(block).toMatch(/AgentFlow[^\n]*To use: call the same-origin proxy at `\/api\/primitive\/agentflow\//)
      expect(block).toMatch(/AgentFlow[^\n]*NO Authorization header needed/)
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

    it('is a real direct-fetch target via its runtime proxy, not framed as already-provisioned (#510 fix — was in RUNTIME_PROXIED_PRIMITIVES gap)', () => {
      const block = codegenCompositionBlock('a startup cap table and equity management tool', 'company')
      expect(block).toContain('OpenCapStack')
      expect(block).not.toMatch(/OpenCapStack[^\n]*already provisioned for this company server-side/)
      expect(block).toMatch(/OpenCapStack[^\n]*GET \/api\/opencapstack\/company/)
    })
  })

  describe('#510 fix — the 8 primitives wired live tonight are real direct-fetch targets, not cosmetic', () => {
    // Before this fix: the /api/{slug}/[action] proxy routes were live and
    // correctly auth-gated, but NONE of these 8 were in RUNTIME_PROXIED_
    // PRIMITIVES, so codegenCompositionBlock told the model their data "was
    // already provisioned server-side" — i.e. explicitly NOT to call the
    // very proxy that had just been built and live-verified. A generated
    // app could never reach any of them no matter what the founder typed.

    it('ZeroMemory (foundational — always selected) wires the real remember/recall proxy', () => {
      const block = codegenCompositionBlock('a habit tracker app', 'app')
      expect(block).toContain('ZeroMemory')
      expect(block).not.toMatch(/ZeroMemory[^\n]*already provisioned for this company server-side/)
      expect(block).toMatch(/ZeroMemory[^\n]*POST \/api\/memory\/remember/)
      expect(block).toMatch(/ZeroMemory[^\n]*POST \/api\/memory\/recall/)
    })

    it('Browser Agent wires the real extract/act proxy for a scraping idea', () => {
      const { names } = selectPrimitives('a tool that scrapes competitor pricing from their websites', 'app')
      expect(names).toContain('Browser Agent')
      const block = codegenCompositionBlock('a tool that scrapes competitor pricing from their websites', 'app')
      expect(block).not.toMatch(/Browser Agent[^\n]*already provisioned for this company server-side/)
      expect(block).toMatch(/Browser Agent[^\n]*POST \/api\/browser-agent\/extract/)
      expect(block).toMatch(/Browser Agent[^\n]*POST \/api\/browser-agent\/act/)
    })

    it('Agent402 wires the real capabilities/projects proxy for an agentic-payments idea', () => {
      const block = codegenCompositionBlock('an agent that pays other agents per API call using x402', 'company')
      expect(block).toContain('Agent402')
      expect(block).not.toMatch(/Agent402[^\n]*already provisioned for this company server-side/)
      expect(block).toMatch(/Agent402[^\n]*GET \/api\/agent402\/capabilities/)
      expect(block).toMatch(/Agent402[^\n]*GET \/api\/agent402\/projects/)
      // Payments/Hedera/payouts are deliberately excluded from the allowlist —
      // the instruction must not imply they're reachable.
      expect(block).not.toMatch(/Agent402[^\n]*\/api\/agent402\/payouts/)
    })

    it('Model Catalog wires the real /list proxy for a model-selection idea (also fixes: had no apiBase, was filtered out of codegen entirely)', () => {
      const block = codegenCompositionBlock('a tool to compare AI model pricing and pick the best LLM for a task', 'app')
      expect(block).toContain('Model Catalog')
      expect(block).not.toMatch(/Model Catalog[^\n]*already provisioned for this company server-side/)
      expect(block).toMatch(/Model Catalog[^\n]*GET \/api\/model-catalog\/list/)
    })

    it('Developer Program wires the real analytics/logs proxy for a monetization idea, excluding earnings/payouts', () => {
      const block = codegenCompositionBlock('an API marketplace where developers sell access and get Stripe Connect payouts', 'company')
      expect(block).toContain('Developer Program')
      expect(block).not.toMatch(/Developer Program[^\n]*already provisioned for this company server-side/)
      expect(block).toMatch(/Developer Program[^\n]*GET \/api\/developer-program\/analytics/)
      expect(block).toMatch(/Developer Program[^\n]*GET \/api\/developer-program\/logs/)
      expect(block).not.toMatch(/Developer Program[^\n]*\/api\/developer-program\/earnings/)
    })

    it('Community wires the real /members proxy for a social/community idea', () => {
      const block = codegenCompositionBlock('a community platform with member groups and a social feed', 'app')
      expect(block).toContain('Community')
      expect(block).not.toMatch(/Community[^\n]*already provisioned for this company server-side/)
      expect(block).toMatch(/Community[^\n]*GET \/api\/community\/members/)
    })

    it('AINativeNGO wires the real /institutions proxy for a nonprofit idea', () => {
      const block = codegenCompositionBlock('a nonprofit that tracks donors and grant applications', 'company')
      expect(block).toContain('AINativeNGO')
      expect(block).not.toMatch(/AINativeNGO[^\n]*already provisioned for this company server-side/)
      expect(block).toMatch(/AINativeNGO[^\n]*GET \/api\/ainative-ngo\/institutions/)
    })

    it('OpenCapStack wires the real /company proxy for a cap-table idea (duplicate coverage alongside the #302 describe block above, kept for a single source of truth on the 8)', () => {
      const block = codegenCompositionBlock('a startup cap table and equity management tool', 'company')
      expect(block).toContain('OpenCapStack')
      expect(block).not.toMatch(/OpenCapStack[^\n]*already provisioned for this company server-side/)
      expect(block).toMatch(/OpenCapStack[^\n]*GET \/api\/opencapstack\/company/)
    })

    it('none of the 8 leak a raw external apiBase into the prompt (would guarantee a client-side fetch failure)', () => {
      const ideas: Array<[string, 'app' | 'company']> = [
        ['a habit tracker app', 'app'],
        ['a tool that scrapes competitor pricing from their websites', 'app'],
        ['an agent that pays other agents per API call using x402', 'company'],
        ['a tool to compare AI model pricing and pick the best LLM for a task', 'app'],
        ['an API marketplace where developers sell access and get Stripe Connect payouts', 'company'],
        ['a community platform with member groups and a social feed', 'app'],
        ['a nonprofit that tracks donors and grant applications', 'company'],
        ['a startup cap table and equity management tool', 'company'],
      ]
      const rawBases = [
        'api.ainative.studio/api/v1/public/memory',
        'api.ainative.studio/api/v1/public/browser',
        'agent-402-production.up.railway.app',
        'api.ainative.studio/api/v1/public/models',
        'api.ainative.studio/api/v1/public/developer',
        // Community's apiBase (api.ainative.studio/api/v1) is too generic to
        // assert against without false positives from unrelated foundational
        // ZeroDB text — its own route-shape assertion above is sufficient.
        'ngo.ainative.studio',
        'api.opencapstack.com',
      ]
      for (const [idea, track] of ideas) {
        const block = codegenCompositionBlock(idea, track)
        for (const base of rawBases) expect(block).not.toContain(base)
      }
    })
  })

  describe('#522 fix — ZeroVoice runtime proxy (real, live, auth-gated API had NO call path)', () => {
    // Before this fix: ZeroVoice's per-company account was provisioned at
    // checkout (#415's ZEROVOICE_PROVISION_ENABLED flag), but ZeroVoice was
    // missing from RUNTIME_PROXIED_PRIMITIVES entirely — codegenCompositionBlock
    // fell to the "already provisioned server-side, do NOT call directly"
    // framing, same bug class #510 fixed for the other 8. A calls/SMS idea's
    // generated app therefore had zero real way to reach ZeroVoice.
    const CALL_SMS_IDEA = 'an appointment reminder app that places outbound phone calls and sends SMS text messages to customers'

    it('a calls/SMS-triggering idea selects ZeroVoice', () => {
      const { names } = selectPrimitives(CALL_SMS_IDEA, 'company')
      expect(names).toContain('ZeroVoice')
    })

    it('wires the real same-origin proxy, not the "already provisioned server-side" placeholder', () => {
      const block = codegenCompositionBlock(CALL_SMS_IDEA, 'company')
      expect(block).toContain('ZeroVoice')
      expect(block).not.toMatch(/ZeroVoice[^\n]*already provisioned for this company server-side/)
      expect(block).toMatch(/ZeroVoice[^\n]*To use: call the same-origin proxy at `\/api\/primitive\/zerovoice\//)
      expect(block).toMatch(/ZeroVoice[^\n]*NO Authorization header needed/)
    })

    it('the literal call shape references the real, live-confirmed endpoint paths (POST /calls/outbound, POST /sms/send)', () => {
      const block = codegenCompositionBlock(CALL_SMS_IDEA, 'company')
      expect(block).toMatch(/POST \/api\/primitive\/zerovoice\/calls\/outbound/)
      expect(block).toMatch(/POST \/api\/primitive\/zerovoice\/sms\/send/)
      expect(block).toMatch(/ANTI-PATTERN — FORBIDDEN/)
    })

    it('does not leak the raw external ZeroVoice apiBase into the prompt', () => {
      const block = codegenCompositionBlock(CALL_SMS_IDEA, 'company')
      expect(block).not.toContain('zerovoice-production.up.railway.app')
    })

    it('RUNTIME_PROXY_PATH_SUBSTRINGS carries the real proxy paths so the #518 compliance validator catches an unwired ZeroVoice selection', () => {
      expect(RUNTIME_PROXY_PATH_SUBSTRINGS.ZeroVoice).toEqual([
        '/api/primitive/zerovoice/calls/outbound',
        '/api/primitive/zerovoice/sms/send',
      ])
      expect(getComplianceCheckedPrimitiveNames()).toContain('ZeroVoice')
    })

    it('getRuntimeProxyInstruction returns the same instruction text codegenCompositionBlock injects', () => {
      const instruction = getRuntimeProxyInstruction('ZeroVoice')
      expect(instruction).toBeDefined()
      expect(instruction).toMatch(/POST \/api\/primitive\/zerovoice\/calls\/outbound/)
      expect(instruction).toMatch(/ANTI-PATTERN — FORBIDDEN/)
      const block = codegenCompositionBlock(CALL_SMS_IDEA, 'company')
      expect(block).toContain(instruction!.split('\n')[0])
    })

    it('#522 regression guard: a memory/recall idea (no calls/SMS language) must NOT select ZeroVoice — the bare "call"/"calls" triggers were removed precisely because "recalls" is a substring match', () => {
      const journalIdea = 'a personal journaling app with memory of past entries that recalls relevant history when I write something new'
      const { names } = selectPrimitives(journalIdea, 'company')
      expect(names).not.toContain('ZeroVoice')
    })
  })

  describe('company role selection (#448 — "build a company" outcome legibility)', () => {
    // Deliberately generic/vague ideas with NO trigger-word matches for the
    // role's own primitives — this is the real regression risk: a role must
    // bias selection even when nothing in the idea text hints at it, or role
    // selection would be a no-op for most founders (who won't type "CRM"
    // themselves, that's the whole point of picking a role instead).
    const VAGUE_IDEA = 'a small business that wants to grow'

    it('no role: a vague idea does not surface role-specific primitives beyond what triggers match', () => {
      const { names } = selectPrimitives(VAGUE_IDEA, 'company')
      expect(names).not.toContain('ZeroPipeline')
      expect(names).not.toContain('Content Workflow')
      expect(names).not.toContain('ZeroERP')
    })

    it('sales role: surfaces ZeroPipeline/ZeroInvoice/ZeroCommerce even with zero keyword overlap', () => {
      const { names } = selectPrimitives(VAGUE_IDEA, 'company', 6, 'sales')
      expect(names).toContain('ZeroPipeline')
      expect(names).toContain('ZeroInvoice')
      expect(names).toContain('ZeroCommerce')
    })

    it('marketing role: surfaces Content Workflow/Live Streaming even with zero keyword overlap', () => {
      const { names } = selectPrimitives(VAGUE_IDEA, 'company', 6, 'marketing')
      expect(names).toContain('Content Workflow')
      expect(names).toContain('Live Streaming')
      // Sales-only primitives should not be pulled in by the marketing role.
      expect(names).not.toContain('ZeroInvoice')
    })

    it('operations role: surfaces ZeroERP/ServiceOS/ZeroForms/ZeroBooks even with zero keyword overlap', () => {
      const { names } = selectPrimitives(VAGUE_IDEA, 'company', 6, 'operations')
      expect(names).toContain('ZeroERP')
      expect(names).toContain('ServiceOS')
      expect(names).toContain('ZeroForms')
      expect(names).toContain('ZeroBooks')
    })

    it('the same idea produces materially different selections across roles (the actual product goal)', () => {
      const sales = selectPrimitives(VAGUE_IDEA, 'company', 6, 'sales').names
      const marketing = selectPrimitives(VAGUE_IDEA, 'company', 6, 'marketing').names
      const operations = selectPrimitives(VAGUE_IDEA, 'company', 6, 'operations').names
      expect(sales).not.toEqual(marketing)
      expect(sales).not.toEqual(operations)
      expect(marketing).not.toEqual(operations)
    })

    it('role has no effect on the app track (roles are a company-track concept only)', () => {
      const withRole = selectPrimitives(VAGUE_IDEA, 'app', 6, 'sales').names
      const withoutRole = selectPrimitives(VAGUE_IDEA, 'app', 6).names
      expect(withRole).toEqual(withoutRole)
    })

    it('codegenCompositionBlock surfaces the role framing line and role-emphasized primitives', () => {
      const block = codegenCompositionBlock(VAGUE_IDEA, 'company', 'sales')
      expect(block).toContain('ZeroPipeline')
      expect(block).toContain('ZeroInvoice')
    })

    it('catalogPromptBlock tells the model this is a role-focused build', () => {
      const block = catalogPromptBlock(VAGUE_IDEA, 'company', 'marketing')
      expect(block).toMatch(/Marketing build/i)
    })

    it('an idea that already trigger-matches a DIFFERENT role still gets the picked role emphasized', () => {
      // Idea text says "inventory" (ZeroERP/operations trigger), but founder
      // picked "sales" — sales primitives must still be present.
      const { names } = selectPrimitives('a shop that tracks inventory', 'company', 6, 'sales')
      expect(names).toContain('ZeroCommerce') // real trigger match ('inventory' -> ZeroCommerce too)
      expect(names).toContain('ZeroPipeline') // role-boosted despite no trigger match
    })
  })
})

// =======================================
// primitiveGroundingBlock (#519) — the planning-artifact sibling of
// codegenCompositionBlock. Same selectPrimitives() call, phrased as prose
// instruction for a business-writing model instead of a coding one.
// =======================================
describe('primitiveGroundingBlock (#519)', () => {
  const journalingIdea =
    'a personal journaling app that remembers my past entries and recalls relevant memories when I write something new'

  it('is exported as a function', async () => {
    const { primitiveGroundingBlock } = await import('@/lib/build/primitive-catalog')
    expect(typeof primitiveGroundingBlock).toBe('function')
  })

  it('lists the real, idea-matched primitives (mirrors selectPrimitives) for a memory-recall idea', async () => {
    const { primitiveGroundingBlock, selectPrimitives } = await import('@/lib/build/primitive-catalog')
    const block = primitiveGroundingBlock(journalingIdea, 'company')
    const { names } = selectPrimitives(journalingIdea, 'company')
    for (const name of names) {
      expect(block, `grounding block must list ${name}`).toContain(name)
    }
    expect(block).toContain('ZeroMemory')
    expect(block).toContain('ZeroDB')
  })

  it('instructs citing real primitives instead of inventing third-party tools', async () => {
    const { primitiveGroundingBlock } = await import('@/lib/build/primitive-catalog')
    const block = primitiveGroundingBlock(journalingIdea, 'company')
    expect(block).toMatch(/cite THESE real, already-selected AINative primitives/i)
    expect(block).toMatch(/Do NOT invent or suggest[^.]*third-party tools/i)
    // Names the exact tools the real production bug invented, so the model
    // sees concrete examples of what NOT to say.
    expect(block).toMatch(/OpenAI/)
    expect(block).toMatch(/Firebase/)
  })

  it('produces materially different idea-matched primitive lists (not a hardcoded shortlist)', async () => {
    const { primitiveGroundingBlock } = await import('@/lib/build/primitive-catalog')
    const journaling = primitiveGroundingBlock(journalingIdea, 'company')
    const crm = primitiveGroundingBlock('a B2B sales CRM to track deals and leads', 'company')
    // ZeroMemory is foundational (always selected on the company track), so it
    // appears in both — the real signal of idea-specificity is the non
    // -foundational, trigger-matched primitive each idea pulls in.
    expect(journaling).toContain('ZeroMemory')
    expect(crm).toContain('ZeroPipeline')
    expect(journaling).not.toContain('ZeroPipeline')
  })

  it('always includes the foundational primitives even for a non-matching idea', async () => {
    const { primitiveGroundingBlock } = await import('@/lib/build/primitive-catalog')
    const block = primitiveGroundingBlock('a scheduling app for hair salons', 'company')
    expect(block).toContain('ZeroDB')
  })

  it('does not duplicate primitives that are both foundational and idea-matched', async () => {
    const { primitiveGroundingBlock } = await import('@/lib/build/primitive-catalog')
    const block = primitiveGroundingBlock(journalingIdea, 'company')
    const occurrences = block.split('ZeroMemory —').length - 1
    expect(occurrences).toBe(1)
  })
})

// #518: codegenCompositionBlock's instruction is textually correct but a real
// production run showed the model doesn't reliably follow it (a journaling app's
// ZeroMemory "related memories" feature was hand-rolled client-side keyword
// matching, never calling /api/memory/*). Fix #1: strengthen each
// RUNTIME_PROXIED_PRIMITIVES instruction with a literal, copy-pasteable code
// snippet + explicit anti-pattern language naming the specific hand-rolled
// substitute to forbid — these tests cover that fix directly.
describe('#518: strengthened runtime-proxy instructions (literal code + anti-pattern language)', () => {
  it('ZeroMemory instruction includes a literal fetch() snippet for both remember and recall', () => {
    const block = codegenCompositionBlock('a habit tracker app', 'app')
    expect(block).toMatch(/```js[\s\S]*fetch\('\/api\/memory\/remember'/)
    expect(block).toMatch(/```js[\s\S]*fetch\('\/api\/memory\/recall'/)
  })

  it('ZeroMemory instruction explicitly forbids the exact failure mode observed in production (#518)', () => {
    const block = codegenCompositionBlock('a habit tracker app', 'app')
    expect(block).toMatch(/ANTI-PATTERN — FORBIDDEN/)
    expect(block).toMatch(/client-side keyword\/substring\/word-overlap matching/i)
    expect(block).toMatch(/You MUST call POST \/api\/memory\/remember and POST \/api\/memory\/recall/)
  })

  it('every RUNTIME_PROXIED_PRIMITIVES-backed primitive in the compliance map carries a literal code snippet + anti-pattern warning', () => {
    // Exercise each compliance-checked primitive via an idea that actually
    // selects it, and assert the composition block contains a real code fence
    // and an explicit FORBIDDEN anti-pattern line for that primitive's block.
    const cases: Array<[string, string]> = [
      ['ZeroMemory', 'a habit tracker app'],
      ['Browser Agent', 'a tool that scrapes competitor pricing from their websites'],
      ['Agent402', 'an agent that pays other agents per API call using x402'],
      ['OpenCapStack', 'a startup cap table and equity management tool'],
      ['Model Catalog', 'a tool to compare AI model pricing and pick the best LLM for a task'],
      ['Developer Program', 'an API marketplace where developers sell access and get Stripe Connect payouts'],
      ['Community', 'a community platform with member groups and a social feed'],
      ['AINativeNGO', 'a nonprofit that tracks donors and grant applications'],
    ]
    for (const [name, idea] of cases) {
      const track = ['Agent402', 'OpenCapStack', 'Developer Program', 'AINativeNGO'].includes(name) ? 'company' : 'app'
      const block = codegenCompositionBlock(idea, track as 'app' | 'company')
      expect(block, `${name} block should contain the primitive name`).toContain(name)
      expect(block, `${name} block should contain a code fence`).toMatch(/```js/)
      expect(block, `${name} block should contain an explicit anti-pattern warning`).toMatch(/ANTI-PATTERN — FORBIDDEN/)
    }
  })

  it('RUNTIME_PROXY_PATH_SUBSTRINGS gives a small, greppable fact per compliance-checked primitive', () => {
    expect(RUNTIME_PROXY_PATH_SUBSTRINGS.ZeroMemory).toEqual(['/api/memory/remember', '/api/memory/recall'])
    expect(RUNTIME_PROXY_PATH_SUBSTRINGS['Browser Agent']).toEqual(['/api/browser-agent/extract', '/api/browser-agent/act'])
    expect(RUNTIME_PROXY_PATH_SUBSTRINGS.OpenCapStack).toEqual(['/api/opencapstack/company'])
  })

  it('getComplianceCheckedPrimitiveNames matches the keys of RUNTIME_PROXY_PATH_SUBSTRINGS', () => {
    const names = getComplianceCheckedPrimitiveNames()
    expect(names.sort()).toEqual(Object.keys(RUNTIME_PROXY_PATH_SUBSTRINGS).sort())
    expect(names).toContain('ZeroMemory')
  })

  it('getRuntimeProxyInstruction returns the same instruction text codegenCompositionBlock injects, for reuse in a repair prompt', () => {
    const instruction = getRuntimeProxyInstruction('ZeroMemory')
    expect(instruction).toBeDefined()
    expect(instruction).toMatch(/POST \/api\/memory\/recall/)
    expect(instruction).toMatch(/ANTI-PATTERN — FORBIDDEN/)
    const block = codegenCompositionBlock('a habit tracker app', 'app')
    expect(block).toContain(instruction!.split('\n')[0]) // first line matches verbatim what's in the block
  })

  it('getRuntimeProxyInstruction returns undefined for a primitive with no runtime proxy instruction', () => {
    expect(getRuntimeProxyInstruction('ZeroERP')).toBeUndefined()
    expect(getRuntimeProxyInstruction('totally-not-a-real-primitive')).toBeUndefined()
  })
})
