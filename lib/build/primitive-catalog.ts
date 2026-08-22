/**
 * Machine-readable AINative primitive catalog (#288) — the runtime source of
 * truth for WHICH primitives Cody composes for a given company/app.
 *
 * Derived from docs/AINATIVE_PRIMITIVES.md (and mirrored at
 * https://docs.ainative.studio/llms.txt), including its literal
 * "HOW CODY MAPS A REQUEST → PRIMITIVES" composition table. Previously that
 * mapping lived only as prose and was never read at runtime, so every build
 * collapsed onto the same ~6 primitives regardless of the idea. This module
 * makes the catalog + the need→primitive rule executable so selection is driven
 * by the founder's actual idea/industry.
 *
 * Keep this in sync with docs/AINATIVE_PRIMITIVES.md — the doc stays canonical;
 * this is the derived index the code consumes.
 */

export interface CatalogPrimitive {
  /** Canonical display name, must match docs/AINATIVE_PRIMITIVES.md */
  name: string
  /** Coarse catalog section */
  category:
    | 'business-ops'
    | 'data-memory'
    | 'ai-inference'
    | 'ui'
    | 'agent-cloud'
    | 'auth-billing'
    | 'community'
  /** One-line purpose (for prompts + UI tooltips) */
  purpose: string
  /** Canonical doc URL */
  url: string
  /**
   * Lowercase keyword/intent triggers used to score relevance against a
   * founder's idea. Empty = always-available substrate (never idea-gated).
   */
  triggers: string[]
  /**
   * Foundational primitives every build composes (ZeroDB/ZeroMemory/AI Kit/
   * Agent Cloud). These are always included; `triggers` still lets them rank.
   */
  foundational?: boolean
}

const DOCS = 'https://docs.ainative.studio/docs'

/**
 * The catalog. Ordering is intentional: foundational first, then the
 * business-ops "run a company" layer that most differentiates one build from
 * another, then supporting AI/data primitives.
 */
export const PRIMITIVE_CATALOG: CatalogPrimitive[] = [
  // ---- Foundational substrate (always available) ----
  { name: 'ZeroDB', category: 'data-memory', foundational: true,
    purpose: 'Persistent knowledge layer: vector search, tables, files, events, functions, per-project Postgres',
    url: `${DOCS}/zerodb/overview`,
    triggers: ['data', 'database', 'persist', 'store', 'save', 'records', 'search', 'vectors', 'rag', 'files'] },
  { name: 'Instant DB', category: 'data-memory', foundational: true,
    purpose: 'A live ZeroDB project + API key in one request — no signup/auth/card',
    url: `${DOCS}/api/instant-db`,
    triggers: ['instant', 'prototype', 'zero setup', 'quickstart'] },
  { name: 'ZeroMemory', category: 'data-memory', foundational: true,
    purpose: 'Cognitive memory (working/episodic/semantic), consolidation, decision traces, RDF/SPARQL KG',
    url: `${DOCS}/zeromemory/overview`,
    triggers: ['memory', 'remember', 'personalization', 'personalize', 'context', 'history', 'preferences'] },
  { name: 'AI Kit', category: 'ui', foundational: true,
    purpose: 'UI component framework (React/Vue/Svelte/Next streaming chat, Safety, A2UI)',
    url: `${DOCS}/ai-kit/overview`,
    triggers: ['ui', 'frontend', 'chat', 'interface', 'components', 'streaming'] },
  { name: 'Agent Cloud', category: 'agent-cloud', foundational: true,
    purpose: 'Run the built company autonomously: Agent Swarm, task dispatch, observability, deployments',
    url: `${DOCS}/agent-cloud/overview`,
    triggers: ['autonomous', 'agents', 'swarm', 'overnight', 'automate', 'run itself', '24/7'] },

  // ---- Business-ops: the "run a company" layer (idea-gated, differentiating) ----
  { name: 'ZeroPipeline', category: 'business-ops',
    purpose: 'AI-native CRM + sales pipeline: deals, stages, customers, revenue analytics',
    url: `${DOCS}/business-ops/zeropipeline`,
    triggers: ['crm', 'sales', 'pipeline', 'leads', 'lead', 'customers', 'deals', 'prospects', 'b2b', 'outreach', 'account', 'sell to businesses'] },
  { name: 'ZeroInvoice', category: 'business-ops',
    purpose: 'Invoicing + billing: Stripe payments, QuickBooks sync, customer portals',
    url: `${DOCS}/business-ops/zeroinvoice`,
    triggers: ['invoice', 'invoicing', 'bill', 'billing', 'get paid', 'payments', 'quickbooks', 'accounts receivable', 'subscriptions'] },
  { name: 'ZeroCommerce', category: 'business-ops',
    purpose: 'Headless ecommerce: product catalog, semantic product search, Stripe checkout',
    url: `${DOCS}/business-ops/zerocommerce`,
    triggers: ['ecommerce', 'e-commerce', 'shop', 'store', 'sell products', 'products', 'catalog', 'checkout', 'cart', 'retail', 'dtc', 'merch', 'coffee', 'brand', 'goods', 'inventory', 'orders'] },
  { name: 'ZeroVoice', category: 'business-ops',
    purpose: 'Programmable telephony (Twilio): calls, SMS, IVR, recording + transcription, DNC/TCPA',
    url: `${DOCS}/zerovoice/overview`,
    triggers: ['call', 'calls', 'phone', 'sms', 'text', 'voice', 'telephony', 'ivr', 'dial', 'cold call', 'appointment reminder'] },
  { name: 'OpenCapStack', category: 'business-ops',
    purpose: 'Cap table + equity (OCTA): stakeholders, SAFEs, grants, vesting, waterfall, investor portals',
    url: `${DOCS}/opencapstack/overview`,
    triggers: ['equity', 'cap table', 'captable', 'fundraising', 'fundraise', 'safe', 'investors', 'shares', 'vesting', 'valuation', 'dilution', 'startup equity'] },
  { name: 'ServiceOS', category: 'business-ops',
    purpose: 'Helpdesk / customer-service operations: tickets, queues, agent workflows',
    url: `${DOCS}/business-ops/serviceos`,
    triggers: ['support', 'helpdesk', 'help desk', 'tickets', 'customer service', 'service', 'complaints', 'faq'] },
  { name: 'Content Workflow', category: 'business-ops',
    purpose: 'AI content + distribution: personas, scheduled posts, auto-captions, avatar videos, auto-publish',
    url: `${DOCS}/api/content-workflow`,
    triggers: ['content', 'marketing', 'social', 'social media', 'posts', 'blog', 'creator', 'captions', 'newsletter', 'campaigns', 'seo', 'brand awareness'] },
  { name: 'Live Streaming', category: 'business-ops',
    purpose: 'Streams (RTMPS in / HLS out), real-time chat, VOD, audience analytics, WebRTC',
    url: `${DOCS}/live-streaming/overview`,
    triggers: ['stream', 'streaming', 'live', 'video', 'broadcast', 'webinar', 'events', 'twitch'] },
  { name: 'Intent-Casting Marketplace', category: 'business-ops',
    purpose: 'Two-sided marketplace: agents broadcast goals, businesses respond with agent-readable services',
    url: `${DOCS}/marketplace/overview`,
    triggers: ['marketplace', 'two-sided', 'match', 'matching', 'buyers and sellers', 'services', 'gig', 'booking'] },
  { name: 'Browser Agent', category: 'business-ops',
    purpose: 'Web data extraction + browser automation (MCP)',
    url: `${DOCS}/business-ops/browser-agent`,
    triggers: ['scrape', 'scraping', 'extract', 'crawl', 'browser automation', 'web data', 'monitor prices', 'aggregat'] },

  // ---- Data / AI supporting primitives (idea-gated) ----
  { name: 'Context Graph', category: 'data-memory',
    purpose: 'Knowledge-graph layer over ZeroMemory: entities, edges, multi-hop traversal',
    url: `${DOCS}/api/context-graph`,
    triggers: ['knowledge graph', 'relationships', 'entities', 'graph', 'connections'] },
  { name: 'Search & Discovery', category: 'data-memory',
    purpose: 'Unified + semantic search, autocomplete, trending, recommendations',
    url: `${DOCS}/search/overview`,
    triggers: ['search', 'discovery', 'recommendations', 'recommend', 'browse', 'find', 'autocomplete', 'feed'] },
  { name: 'Data Marketplace', category: 'data-memory',
    purpose: 'Cross-correlated intelligence over property/business/risk/dev (290K SMBs)',
    url: `${DOCS}/api/data-marketplace`,
    triggers: ['market data', 'enrichment', 'business data', 'intelligence', 'research', 'validate market', 'tam'] },
  { name: 'Multimodal', category: 'ai-inference',
    purpose: 'Speech/image/video generation; transcription, TTS, music',
    url: `${DOCS}/api/multimodal`,
    triggers: ['image', 'images', 'photo', 'video', 'audio', 'speech', 'transcribe', 'generate images', 'music', 'avatar'] },
  { name: 'Model Catalog', category: 'ai-inference',
    purpose: '47 models across text/code/reasoning/image/video/audio/embedding',
    url: `${DOCS}/api/models`,
    triggers: ['model', 'llm', 'inference', 'ai model', 'reasoning'] },
  { name: 'Search & Discovery', category: 'data-memory',
    purpose: 'Unified + semantic search, autocomplete, trending, recommendations',
    url: `${DOCS}/search/overview`,
    triggers: [] }, // (dedup guard — see SELECTION below)

  // ---- Payments / monetization (idea-gated) ----
  { name: 'Agent402', category: 'auth-billing',
    purpose: 'Agentic (machine-to-machine) payments over Web3',
    url: `${DOCS}/web3/agent402`,
    triggers: ['agentic payments', 'machine payments', 'x402', 'agent pays', 'pay per call', 'micropayments'] },
  { name: 'Developer Program', category: 'auth-billing',
    purpose: 'Let the app monetize itself: 0–40% markup + Stripe Connect payouts',
    url: `${DOCS}/developer-program/overview`,
    triggers: ['monetize', 'marketplace payout', 'revenue share', 'stripe connect', 'sell api', 'developer earnings'] },
]

/** Fast de-duplicated view (the array above intentionally documents a dup guard). */
const CATALOG_BY_NAME = new Map<string, CatalogPrimitive>()
for (const p of PRIMITIVE_CATALOG) if (!CATALOG_BY_NAME.has(p.name)) CATALOG_BY_NAME.set(p.name, p)
export const CATALOG: CatalogPrimitive[] = Array.from(CATALOG_BY_NAME.values())

/** Real distinct-primitive count — replaces the hardcoded TOTAL_PRIMITIVES=34. */
export const CATALOG_SIZE = CATALOG.length

export function getPrimitive(name: string): CatalogPrimitive | undefined {
  return CATALOG_BY_NAME.get(name)
}

export interface PrimitiveScore {
  primitive: CatalogPrimitive
  score: number
  matched: string[]
}

/**
 * Score every catalog primitive against a founder's idea by keyword/intent
 * overlap. Foundational primitives get a floor so the substrate is always
 * present, but a strong idea-match still outranks them for ordering.
 */
export function scorePrimitives(idea: string, track: 'app' | 'company' = 'company'): PrimitiveScore[] {
  const hay = ` ${(idea || '').toLowerCase()} `
  return CATALOG.map((primitive) => {
    const matched = primitive.triggers.filter((t) => hay.includes(` ${t}`) || hay.includes(`${t} `) || hay.includes(t))
    let score = matched.length
    if (primitive.foundational) score += 0.5 // floor so substrate always ranks
    // On the company track, the "run a company" business-ops layer is the whole
    // point — give it a slight nudge so a live company surfaces real ops.
    if (track === 'company' && primitive.category === 'business-ops') score += 0.25
    return { primitive, score, matched }
  }).sort((a, b) => b.score - a.score)
}

export interface SelectionResult {
  /** Foundational substrate, always wired */
  foundational: CatalogPrimitive[]
  /** Idea-matched primitives (beyond foundational), highest relevance first */
  selected: CatalogPrimitive[]
  /** Convenience: names of everything to surface, deduped, foundational first */
  names: string[]
}

/**
 * Select the primitives to compose for a given idea. Returns the foundational
 * substrate plus the top idea-matched business/support primitives. This is what
 * the composition prompt, Live dashboard, "Powering this", and Ask Cody should
 * all consume — so two different ideas produce materially different sets.
 *
 * @param maxSelected cap on idea-matched (non-foundational) primitives (default 6)
 */
export function selectPrimitives(
  idea: string,
  track: 'app' | 'company' = 'company',
  maxSelected = 6,
): SelectionResult {
  const scored = scorePrimitives(idea, track)
  const foundational = CATALOG.filter((p) => p.foundational)
  const selected = scored
    .filter((s) => !s.primitive.foundational && s.matched.length > 0)
    .slice(0, maxSelected)
    .map((s) => s.primitive)
  const names: string[] = []
  for (const p of [...foundational, ...selected]) if (!names.includes(p.name)) names.push(p.name)
  return { foundational, selected, names }
}

/**
 * Render the catalog + the founder's most relevant primitives as a compact
 * block to inject into a generation/system prompt. Gives the model the FULL
 * catalog to choose from (so it isn't anchored on a hardcoded shortlist) while
 * highlighting the idea-matched candidates.
 */
export function catalogPromptBlock(idea: string, track: 'app' | 'company' = 'company'): string {
  const { names } = selectPrimitives(idea, track)
  const full = CATALOG.map((p) => `- ${p.name}: ${p.purpose}`).join('\n')
  return (
    `AINATIVE PRIMITIVE CATALOG (compose from THESE real products — do not invent primitives):\n${full}\n\n` +
    `Most relevant to this idea (lead with these, add others only if the idea calls for them): ${names.join(', ')}.\n` +
    `Pick the primitives THIS specific idea needs and say how each is used. Do not default to a generic set.`
  )
}
