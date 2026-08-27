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
