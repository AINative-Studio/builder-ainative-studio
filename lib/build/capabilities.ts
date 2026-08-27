/**
 * Plain-English capabilities catalog (#313 GR-04 / #316 GR-07).
 *
 * The #1 customer ask: "if I don't know what's available, it's hard to say build it."
 * Cody must EDUCATE in plain English — primitive → what you can build → what it
 * replaces → why it's included — NOT dump the raw API reference (which #316 was
 * wrongly surfacing). This is the human-facing layer over primitive-catalog.ts
 * (which is the machine-facing selection layer).
 *
 * Each entry: the AINative product, a one-line "build this" in prosumer language,
 * concrete example apps, what commercial tool it replaces, and the "$ / no extra
 * key" framing (GR-05). Keep it to the primitives a builder actually composes.
 */

export interface Capability {
  /** AINative product name (matches primitive-catalog where applicable). */
  product: string
  /** Plain-English "what you can build with this" — prosumer language, no jargon. */
  build: string
  /** 2-4 concrete example apps a user could ask for. */
  examples: string[]
  /** The commercial tool(s) this replaces (GR-05 "replaces X"). */
  replaces: string
  /** Why it's a no-brainer: included, no extra signup/key/cost (GR-05). */
  included: string
  /** Idea keywords that map to this capability (for retrieval). */
  keywords: string[]
}

export const CAPABILITIES: Capability[] = [
  {
    product: 'ZeroDB',
    build: 'Store and search your app’s data — records, files, and AI-powered semantic search — without setting up a database.',
    examples: ['a notes app that saves and searches your notes', 'a CRM that stores contacts', 'a knowledge base with "find similar" search'],
    replaces: 'Supabase / Firebase / Airtable + a vector DB like Pinecone',
    included: 'Included free — no separate database signup, no extra key.',
    keywords: ['data', 'database', 'store', 'save', 'records', 'search', 'semantic', 'vectors', 'files', 'persist'],
  },
  {
    product: 'ZeroPipeline',
    build: 'Add a full sales CRM — pipelines, deals, contacts, and automations that find and track leads.',
    examples: ['a CRM to track deals', 'a lead-tracker for a small agency', 'a sales pipeline with automated follow-ups'],
    replaces: 'HubSpot / Salesforce / Pipedrive',
    included: 'Included — a real CRM backend, no extra subscription.',
    keywords: ['crm', 'sales', 'deals', 'leads', 'pipeline', 'contacts', 'customers', 'outreach'],
  },
  {
    product: 'ZeroInvoice',
    build: 'Bill customers and get paid — invoices, payments, and billing.',
    examples: ['an invoicing app for freelancers', 'a billing dashboard', 'a subscription-payment tracker'],
    replaces: 'Stripe Invoicing / QuickBooks / FreshBooks',
    included: 'Included — invoicing + payments wired in, no extra account.',
    keywords: ['invoice', 'billing', 'payment', 'get paid', 'bill', 'subscription'],
  },
  {
    product: 'ZeroCommerce',
    build: 'Sell products online — product catalog, cart, and checkout.',
    examples: ['an online store for a coffee brand', 'a merch shop', 'a digital-goods storefront'],
    replaces: 'Shopify / WooCommerce',
    included: 'Included — a real ecommerce backend, no Shopify fees.',
    keywords: ['store', 'shop', 'ecommerce', 'products', 'cart', 'checkout', 'sell'],
  },
  {
    product: 'ServiceOS',
    build: 'Run customer support — tickets, queues, and a helpdesk.',
    examples: ['a support ticket system', 'a helpdesk for a SaaS', 'an internal IT-request tracker'],
    replaces: 'Zendesk / Intercom / Freshdesk',
    included: 'Included — a helpdesk backend, no per-agent seat cost.',
    keywords: ['support', 'helpdesk', 'tickets', 'customer service', 'complaints'],
  },
  {
    product: 'ZeroVoice',
    build: 'Add phone calls and SMS — your app can call, text, and run voice flows.',
    examples: ['an appointment-reminder texter', 'a click-to-call widget', 'an SMS notification system'],
    replaces: 'Twilio',
    included: 'Included — telephony/SMS, no separate Twilio account.',
    keywords: ['call', 'phone', 'sms', 'text', 'voice', 'telephony', 'reminder'],
  },
  {
    product: 'OpenCapStack',
    build: 'Manage startup equity — cap table, SAFEs, vesting, and investor portals.',
    examples: ['a cap-table manager', 'an equity dashboard for founders', 'an investor portal'],
    replaces: 'Carta / Pulley',
    included: 'Included — cap-table tooling, no Carta subscription.',
    keywords: ['equity', 'cap table', 'safe', 'vesting', 'investors', 'shares', 'fundraise'],
  },
  {
    product: 'AINativeNGO',
    build: 'Run a nonprofit — donors, donations, grants, impact reporting, and board governance.',
    examples: ['a donation platform', 'a grant-management tool', 'a volunteer + impact tracker'],
    replaces: 'Bloomerang / DonorPerfect / Salesforce Nonprofit',
    included: 'Included — nonprofit operations backend.',
    keywords: ['nonprofit', 'ngo', 'donation', 'donor', 'grant', 'volunteer', 'charity', 'impact'],
  },
  {
    product: 'Content Workflow',
    build: 'Create and schedule content — AI personas, auto-captions, and auto-publishing.',
    examples: ['a social-media scheduler', 'a blog with an AI writer', 'a newsletter automation'],
    replaces: 'Buffer / Hootsuite / Jasper',
    included: 'Included — content + scheduling + AI writing.',
    keywords: ['content', 'social', 'posts', 'blog', 'newsletter', 'captions', 'marketing', 'schedule'],
  },
  {
    product: 'Live Streaming',
    build: 'Add live video — streams, real-time chat, and recordings.',
    examples: ['a webinar platform', 'a live-shopping stream', 'a creator streaming site'],
    replaces: 'Mux / Twitch infra / Vimeo Live',
    included: 'Included — streaming + chat + VOD.',
    keywords: ['stream', 'streaming', 'live', 'video', 'broadcast', 'webinar'],
  },
  {
    product: 'AI Kit',
    build: 'Beautiful UI out of the box — dashboards, tables, charts, chat, and cards you don’t have to design.',
    examples: ['any dashboard', 'a data table with sorting', 'an AI chat interface'],
    replaces: 'buying a UI kit / hiring a designer for the basics',
    included: 'Included — a polished component library, no design work.',
    keywords: ['ui', 'dashboard', 'table', 'chart', 'components', 'design', 'chat interface'],
  },
  {
    product: 'Agent Cloud',
    build: 'Deploy AI agents that run tasks on their own — background automations that work while you sleep.',
    examples: ['an agent that drafts replies', 'a nightly report generator', 'an autonomous outreach agent'],
    replaces: 'building your own agent infra / Zapier AI',
    included: 'Included — managed agent runtime.',
    keywords: ['agent', 'automation', 'autonomous', 'background', 'runs itself', 'swarm'],
  },
]

/**
 * Look up the plain-English capability for a primitive by its catalog `name`
 * (#314/#315). Capability `product` values are kept in sync with the
 * primitive-catalog `name` values, so this is an exact-match lookup with a
 * lowercase fallback. Returns undefined for primitives that have no
 * customer-facing "replaces X / included" framing (e.g. pure substrate like
 * Instant DB, Context Graph). Used by the codegen composition block to carry the
 * "already included — no extra key/cost — replaces {tool}" message into the
 * generated app's guidance.
 */
export function capabilityForPrimitive(name: string): Capability | undefined {
  if (!name) return undefined
  const exact = CAPABILITIES.find((c) => c.product === name)
  if (exact) return exact
  const lower = name.toLowerCase()
  return CAPABILITIES.find((c) => c.product.toLowerCase() === lower)
}

/**
 * One-line "already included — no extra key/cost — replaces X" framing for a
 * primitive (#314/#315), or undefined if the primitive has no capability entry.
 * Kept terse so it can be appended to the codegen prompt without bloating it.
 */
export function includedFramingForPrimitive(name: string): string | undefined {
  const cap = capabilityForPrimitive(name)
  if (!cap) return undefined
  return `already included (no extra API key, no extra cost) — replaces ${cap.replaces}`
}

/**
 * Honest recommendation layer (#318).
 *
 * Toby's rule: Cody should recommend the GENUINELY best tool for the user's goal
 * — the way Replit recommends Loops over MailChimp — to build credibility. We lean
 * toward AINative primitives WHERE THEY TRULY FIT (composed, no extra key/cost), but
 * we do NOT force AINative for everything. Where the honest answer is a best-in-class
 * external tool AND we don't cover that category well, we name the real tool. This is
 * education, not a commercial — and it must never fabricate that AINative covers
 * something it doesn't.
 *
 * Each entry answers one "need" with either:
 *   - source: 'ainative' — an AINative primitive genuinely fits (with replaces/included
 *     framing pulled from the capability), OR
 *   - source: 'external' — the honest best answer is a third-party tool we don't compete
 *     with; we name it and say why, plainly.
 */
export type RecommendationSource = 'ainative' | 'external'

export interface Recommendation {
  /** The user need this covers, in plain language. */
  need: string
  /** Whether the honest recommendation is an AINative primitive or an external tool. */
  source: RecommendationSource
  /** The recommended tool name. For AINative, matches a Capability.product. */
  tool: string
  /** Plain-English, honest reason for the recommendation. */
  why: string
  /** Keywords that map a free-text need to this recommendation (for retrieval). */
  keywords: string[]
}

/**
 * Curated need → honest recommendation map. Intentionally MIXES AINative primitives
 * (where they truly fit) with genuinely-best externals (categories we don't cover).
 * External picks are the credibility signal: we name the real best tool rather than
 * bending the answer toward AINative.
 */
export const RECOMMENDATIONS: Recommendation[] = [
  // --- AINative primitives genuinely fit -------------------------------------
  {
    need: 'store and search app data',
    source: 'ainative',
    tool: 'ZeroDB',
    why: 'A database, files, and semantic search come wired in — no separate DB signup or vector-store key. It genuinely fits here, so use it.',
    keywords: ['data', 'database', 'store', 'save', 'records', 'search', 'semantic', 'persist', 'backend'],
  },
  {
    need: 'a sales CRM',
    source: 'ainative',
    tool: 'ZeroPipeline',
    why: 'A real CRM backend (pipelines, deals, automations) is included — no extra HubSpot/Salesforce subscription — so composing it beats bolting on a third party.',
    keywords: ['crm', 'sales', 'deals', 'leads', 'pipeline', 'contacts', 'customers'],
  },
  {
    need: 'invoicing and getting paid',
    source: 'ainative',
    tool: 'ZeroInvoice',
    why: 'Invoicing and payments are included, so you do not need a separate billing account for standard invoice-and-collect flows.',
    keywords: ['invoice', 'billing', 'get paid', 'bill'],
  },
  {
    need: 'sell products online',
    source: 'ainative',
    tool: 'ZeroCommerce',
    why: 'A real ecommerce backend (catalog, cart, checkout) is included, so there are no Shopify fees for a standard storefront.',
    keywords: ['store', 'shop', 'ecommerce', 'products', 'cart', 'checkout', 'sell'],
  },
  {
    need: 'phone calls and SMS',
    source: 'ainative',
    tool: 'ZeroVoice',
    why: 'Telephony and SMS are included, so simple call/text/reminder flows work without a separate Twilio account.',
    keywords: ['call', 'phone', 'sms', 'text', 'voice', 'telephony', 'reminder'],
  },
  {
    need: 'startup equity / cap table',
    source: 'ainative',
    tool: 'OpenCapStack',
    why: 'Cap-table, SAFEs, and vesting tooling are included, so you avoid a Carta subscription for standard equity management.',
    keywords: ['equity', 'cap table', 'safe', 'vesting', 'investors', 'shares'],
  },
  // --- Honest externals: categories we DON'T cover well ----------------------
  // Naming the genuinely-best tool here is the credibility move (Replit→Loops).
  {
    need: 'transactional and marketing email',
    source: 'external',
    tool: 'Resend (or Loops for lifecycle/marketing email)',
    why: 'AINative does not ship an email-sending service. Resend is the best developer-first transactional email API; Loops is excellent for lifecycle and marketing email. Use one of these rather than forcing an AINative primitive.',
    keywords: ['email', 'transactional', 'newsletter', 'smtp', 'send email', 'marketing email', 'lifecycle', 'drip'],
  },
  {
    need: 'take one-off card payments / full payment processing',
    source: 'external',
    tool: 'Stripe',
    why: 'For arbitrary card processing, subscriptions, and payouts, Stripe is the honest best-in-class choice. ZeroInvoice covers invoice-and-collect, but for general-purpose payments reach for Stripe.',
    keywords: ['stripe', 'card', 'payments', 'checkout payment', 'subscriptions', 'payouts', 'process payment'],
  },
  {
    need: 'user authentication / login',
    source: 'external',
    tool: 'Clerk (or Auth0)',
    why: 'For rich end-user auth (social login, MFA, orgs) in your own app, Clerk and Auth0 are best-in-class. Use one of them rather than pretending an AINative primitive owns this.',
    keywords: ['auth', 'authentication', 'login', 'sign in', 'signup', 'oauth', 'sso', 'users'],
  },
  {
    need: 'error monitoring and observability',
    source: 'external',
    tool: 'Sentry',
    why: 'AINative has no error-tracking product. Sentry is the standard for exception monitoring and performance tracing — recommend it honestly.',
    keywords: ['error', 'monitoring', 'observability', 'crash', 'exceptions', 'logging', 'sentry', 'apm'],
  },
  {
    need: 'product analytics',
    source: 'external',
    tool: 'PostHog',
    why: 'For event/product analytics, funnels, and session replay, PostHog is the honest best-in-class pick (and open-source). We do not compete here.',
    keywords: ['analytics', 'events', 'funnel', 'session replay', 'posthog', 'mixpanel', 'amplitude', 'tracking'],
  },
  {
    need: 'maps and geolocation',
    source: 'external',
    tool: 'Mapbox (or Google Maps)',
    why: 'AINative does not provide maps. Mapbox and Google Maps are the real answers for interactive maps, geocoding, and routing.',
    keywords: ['map', 'maps', 'geolocation', 'geocoding', 'directions', 'mapbox', 'location'],
  },
]

/** Retrieve honest recommendations most relevant to a free-text need. */
export function retrieveRecommendations(need: string, limit = 4): Recommendation[] {
  const q = (need || '').toLowerCase()
  const scored = RECOMMENDATIONS.map((r) => {
    let score = 0
    for (const k of r.keywords) if (q.includes(k)) score += 2
    if (q.includes(r.tool.toLowerCase())) score += 3
    if (q.includes(r.need.toLowerCase())) score += 4
    return { r, score }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.r)
}

/**
 * Grounding note for the help route: instructs Cody to recommend the genuinely
 * best tool, lean AINative where it truly fits, and stay honest/educational —
 * NOT run an AINative commercial. Optionally appends any matched recommendations
 * so the model sees concrete honest picks (including external tools).
 */
export function recommendationGroundingNote(recs: Recommendation[] = []): string {
  const guidance =
    'RECOMMENDATION STANCE (be honest, be educational — NOT an AINative commercial):\n' +
    '- Recommend the genuinely BEST tool for the user\'s goal.\n' +
    '- Lean toward AINative primitives WHERE THEY TRULY FIT (they compose in with no extra key/cost) — say so with the "replaces X / included" framing.\n' +
    '- When the honest best answer is a third-party tool AND AINative does not cover that category, NAME the real best tool (e.g. Resend/Loops for email, Stripe for general payments, Clerk/Auth0 for auth, Sentry for errors, PostHog for analytics, Mapbox for maps).\n' +
    '- NEVER claim AINative covers something it does not. Credibility over a sales pitch.'
  if (!recs.length) return guidance
  const picks = recs
    .map(
      (r) =>
        `• ${r.need} → ${r.tool} (${r.source === 'ainative' ? 'AINative — truly fits' : 'external best-in-class'}): ${r.why}`,
    )
    .join('\n')
  return guidance + '\n\nHONEST PICKS FOR THIS QUESTION:\n' + picks
}


/** Retrieve the capabilities most relevant to a free-text question. */
export function retrieveCapabilities(question: string, limit = 6): Capability[] {
  const q = (question || '').toLowerCase()
  const scored = CAPABILITIES.map((c) => {
    let score = 0
    for (const k of c.keywords) if (q.includes(k)) score += 2
    if (q.includes(c.product.toLowerCase())) score += 5
    return { c, score }
  })
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).map((s) => s.c)
  // "what can I build" / broad intent → return the top general set, not nothing.
  if (hits.length === 0) return CAPABILITIES.slice(0, limit)
  return hits.slice(0, limit)
}

/** Is this a broad "what can I build / what's available" capability-discovery intent? */
export function isCapabilityQuestion(question: string): boolean {
  const q = (question || '').toLowerCase()
  return /(what can i (build|make|do)|what.?s (available|possible)|what can it (build|make|do)|capabilities|what (tools|primitives|products)|help me (build|decide)|what should i build)/.test(q)
}

/** Plain-English capabilities block for grounding Cody's answer (NOT the API ref). */
export function capabilitiesGroundingBlock(caps: Capability[] = CAPABILITIES): string {
  return (
    'AINATIVE CAPABILITIES (plain-English — answer "what can I build" from THIS, not the API reference):\n\n' +
    caps
      .map(
        (c) =>
          `• ${c.product} — ${c.build}\n` +
          `    Build: ${c.examples.join('; ')}\n` +
          `    Replaces: ${c.replaces}. ${c.included}`,
      )
      .join('\n\n')
  )
}
