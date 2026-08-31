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

import { componentGuidanceBlock } from './primitive-graph'
import { includedFramingForPrimitive } from './capabilities'

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
   * Real base API URL the generated app should call to use this primitive
   * (from docs/AINATIVE_PRIMITIVES.md). Present for primitives that expose a
   * REST/HTTP surface; omitted for SDK-only / MCP-only primitives (use `sdk`).
   * This is what makes codegen COMPOSE (call the real endpoint) instead of
   * regenerating business logic (#218).
   */
  apiBase?: string
  /**
   * npm package / SDK entry point to import instead of hand-rolling logic
   * (e.g. AI Kit UI components, Browser Agent MCP). Additive to `apiBase`.
   */
  sdk?: string
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
  /**
   * MCP server endpoint for this primitive (#73). When present, this primitive
   * is not just callable via REST — Cody can OPERATE it agentically as a set of
   * MCP tools (tool_use), both at build-time (provision/seed real resources) and
   * at run-time (the running company's ops ARE MCP calls). This is the strategic
   * moat: competitors only GENERATE code that calls APIs; Cody drives the
   * primitives through their MCP servers.
   *
   * Sourced from docs/AINATIVE_PRIMITIVES.md §6 (7+ published MCP servers).
   * Purely additive — does NOT affect triggers/scoring (#72) or the tooltip
   * resolver (#66). May be a full HTTPS Streamable-HTTP endpoint or a doc URL
   * pointer for servers whose transport is stdio/npx (e.g. `@ainative/gtm-mcp`).
   */
  mcpUrl?: string
  /**
   * Number of tools the primitive's MCP server exposes (from §6). Undefined when
   * the count isn't published. Feeds the "operated via MCP — your agent can drive
   * this too" surfacing (#66 owns the actual chips) and lets Cody know how rich
   * the agentic surface is before connecting.
   */
  mcpTools?: number
}

const DOCS = 'https://docs.ainative.studio/docs'

/**
 * Base host for AINative's published Streamable-HTTP MCP servers (#73). Override
 * with AINATIVE_MCP_BASE_URL for a self-hosted / staging fleet. The per-primitive
 * `mcpUrl` fields below are built from this so a single env var can retarget the
 * whole fleet. Servers whose transport is stdio/npx (e.g. `@ainative/gtm-mcp`)
 * carry a doc-URL pointer instead of an HTTP endpoint.
 */
const MCP_BASE =
  (typeof process !== 'undefined' && process.env?.AINATIVE_MCP_BASE_URL) ||
  'https://mcp.ainative.studio'

/**
 * The catalog. Ordering is intentional: foundational first, then the
 * business-ops "run a company" layer that most differentiates one build from
 * another, then supporting AI/data primitives.
 */
export const PRIMITIVE_CATALOG: CatalogPrimitive[] = [
  // ---- Foundational substrate (always available) ----
  { name: 'ZeroDB', category: 'data-memory', foundational: true,
    purpose: 'Persistent knowledge layer: vector search, tables, files, events, functions, per-project Postgres — also the store for social posts/feed/comments/likes/messages',
    url: `${DOCS}/zerodb/overview`,
    apiBase: 'https://api.ainative.studio/api/v1',
    // Full ZeroDB MCP (69+ tools, whole data layer) — docs/AINATIVE_PRIMITIVES.md §6.
    // This is the phase-1 build-time wedge: Cody CALLS this MCP to create a real
    // project/tables at preview instead of a mock.
    mcpUrl: `${MCP_BASE}/zerodb`,
    mcpTools: 69,
    triggers: ['data', 'database', 'persist', 'store', 'save', 'records', 'search', 'vectors', 'rag', 'files',
      'posts', 'post', 'feed', 'comments', 'comment', 'likes', 'like', 'timeline', 'messages', 'messaging', 'dm', 'content'] },
  { name: 'Instant DB', category: 'data-memory', foundational: true,
    purpose: 'A live ZeroDB project + API key in one request — no signup/auth/card',
    url: `${DOCS}/api/instant-db`,
    apiBase: 'https://api.ainative.studio/api/v1',
    triggers: ['instant', 'prototype', 'zero setup', 'quickstart'] },
  { name: 'ZeroMemory', category: 'data-memory', foundational: true,
    purpose: 'Cognitive memory (working/episodic/semantic), consolidation, decision traces, RDF/SPARQL KG',
    url: `${DOCS}/zeromemory/overview`,
    // Real REST mount confirmed live (#416): POST /remember, /recall etc. under
    // /api/v1/public/memory/v2 (core: app/api/routers/public.py → zeromemory.py).
    // Uses the SAME ZeroDB project API key provisionInstantDb() already creates —
    // no separate provisioning needed.
    apiBase: 'https://api.ainative.studio/api/v1/public/memory/v2',
    // Memory MCP (18 tools) — docs/AINATIVE_PRIMITIVES.md §6.
    mcpUrl: `${MCP_BASE}/memory`,
    mcpTools: 18,
    triggers: ['memory', 'remember', 'personalization', 'personalize', 'context', 'history', 'preferences'] },
  { name: 'AI Kit', category: 'ui', foundational: true,
    purpose: 'UI component framework (React/Vue/Svelte/Next streaming chat, Safety, A2UI)',
    url: `${DOCS}/ai-kit/overview`,
    sdk: '@ainative/ai-kit-core',
    triggers: ['ui', 'frontend', 'chat', 'interface', 'components', 'streaming'] },
  { name: 'Agent Cloud', category: 'agent-cloud', foundational: true,
    purpose: 'Run the built company autonomously: Agent Swarm, task dispatch, observability, deployments',
    url: `${DOCS}/agent-cloud/overview`,
    apiBase: 'https://api.ainative.studio/api/v1',
    triggers: ['autonomous', 'agents', 'swarm', 'overnight', 'automate', 'run itself', '24/7'] },

  // ---- Business-ops: the "run a company" layer (idea-gated, differentiating) ----
  { name: 'ZeroPipeline', category: 'business-ops',
    purpose: 'AI-native CRM + sales pipeline: deals, stages, customers, revenue analytics',
    url: `${DOCS}/business-ops/zeropipeline`,
    apiBase: 'https://pipeline.ainative.studio/api/v1',
    triggers: ['crm', 'sales', 'pipeline', 'leads', 'lead', 'customers', 'deals', 'prospects', 'b2b', 'outreach', 'account', 'sell to businesses'] },
  { name: 'ZeroInvoice', category: 'business-ops',
    purpose: 'Invoicing + billing: Stripe payments, QuickBooks sync, customer portals',
    url: `${DOCS}/business-ops/zeroinvoice`,
    apiBase: 'https://zeroinvoice.ainative.studio/api',
    triggers: ['invoice', 'invoicing', 'bill', 'billing', 'get paid', 'payments', 'quickbooks', 'accounts receivable', 'subscriptions'] },
  { name: 'ZeroCommerce', category: 'business-ops',
    purpose: 'Headless ecommerce: product catalog, semantic product search, Stripe checkout',
    url: `${DOCS}/business-ops/zerocommerce`,
    apiBase: 'https://zerocommerce.ainative.studio/api/v1',
    triggers: ['ecommerce', 'e-commerce', 'shop', 'store', 'sell products', 'products', 'catalog', 'checkout', 'cart', 'retail', 'dtc', 'merch', 'coffee', 'brand', 'goods', 'inventory', 'orders'] },
  { name: 'ZeroVoice', category: 'business-ops',
    purpose: 'Programmable telephony (Twilio): calls, SMS, IVR, recording + transcription, DNC/TCPA',
    url: `${DOCS}/zerovoice/overview`,
    apiBase: 'https://api.ainative.studio/api/v1',
    // ZeroVoice MCP (25 tools) — docs/AINATIVE_PRIMITIVES.md §6. Lets the running
    // company make/receive real calls + SMS as agentic MCP tool calls (run-time ops).
    mcpUrl: `${MCP_BASE}/zerovoice`,
    mcpTools: 25,
    triggers: ['call', 'calls', 'phone', 'sms', 'text', 'voice', 'telephony', 'ivr', 'dial', 'cold call', 'appointment reminder'] },
  { name: 'ZeroCRM', category: 'business-ops',
    // Distinct product from ZeroPipeline (confirmed via its own repo description,
    // not a rename/duplicate) — a lighter-weight CRM aimed at solo operators
    // rather than ZeroPipeline's fuller B2B sales-pipeline surface.
    purpose: 'Super-light CRM for freelancers, creators, solo founders, and SMBs',
    url: `${DOCS}/business-ops/zerocrm`,
    apiBase: 'https://zerocrm-production.up.railway.app/api/v1',
    triggers: ['simple crm', 'lightweight crm', 'solo founder', 'freelancer', 'creator', 'small business', 'contacts', 'client management'] },
  { name: 'ZeroERP', category: 'business-ops',
    purpose: 'Lightweight, AI-native ERP: inventory, operations, resource planning',
    url: `${DOCS}/business-ops/zeroerp`,
    apiBase: 'https://zeroerp-production.up.railway.app/api/v1',
    triggers: ['erp', 'resource planning', 'operations', 'inventory management', 'manufacturing', 'supply chain', 'warehouse'] },
  { name: 'ZeroForms', category: 'business-ops',
    purpose: 'API-first online forms: build, publish, embed, collect submissions + webhooks',
    url: `${DOCS}/business-ops/zeroforms`,
    apiBase: 'https://zeroforms-production.up.railway.app/api/v1',
    triggers: ['form', 'forms', 'survey', 'intake form', 'signup form', 'contact form', 'questionnaire', 'submission', 'webhook'] },
  { name: 'ZeroBooks', category: 'business-ops',
    purpose: 'AI-native accounting + bookkeeping: transparent pricing, agent-first UX, ZeroDB-backed',
    url: `${DOCS}/business-ops/zerobooks`,
    apiBase: 'https://zerobooks-production.up.railway.app/api/v1',
    triggers: ['accounting', 'bookkeeping', 'ledger', 'chart of accounts', 'financial statements', 'expenses', 'reconciliation'] },
  { name: 'AgentFlow', category: 'agent-cloud',
    purpose: 'No-code visual builder for AI agent workflows: build, run, and stream agent flows',
    url: `${DOCS}/agent-cloud/agentflow`,
    // Real apiBase confirmed via its own live openapi.json (title: "AgentFlow") —
    // note the real prefix is /api/v1/build, not the generic /api/v1 most
    // AINative services use.
    apiBase: 'https://agentflow.ainative.studio/api/v1/build',
    triggers: ['visual agent builder', 'no-code agent', 'workflow builder', 'agent workflow', 'drag and drop agent', 'flow builder'] },
  { name: 'QNN API', category: 'ai-inference',
    purpose: 'Train and run Quantum Neural Networks via API (moonshot-stage)',
    url: `${DOCS}/moonshots/qnn-api`,
    apiBase: 'https://qnn.ainative.studio/api/v1',
    triggers: ['quantum', 'quantum computing', 'quantum neural network', 'qnn', 'quantum machine learning'] },
  { name: 'SpaceTime OS', category: 'data-memory',
    // Real live service is branded "Ocean API — Knowledge & Action Workspace"
    // (confirmed via its own openapi.json) — blocks/links/pages semantic content
    // organization, not literally spacetime/physics-related despite the name.
    purpose: 'Knowledge & action workspace: blocks, links, pages, semantic content organization',
    url: `${DOCS}/data-memory/spacetime-os`,
    apiBase: 'https://oceanapi.ainative.studio/api/v1',
    triggers: ['knowledge base', 'wiki', 'notes', 'notion-like', 'blocks', 'linked notes', 'knowledge management', 'second brain'] },
  { name: 'OpenCapStack', category: 'business-ops',
    purpose: 'Cap table + equity (OCTA): stakeholders, SAFEs, grants, vesting, waterfall, investor portals',
    url: `${DOCS}/opencapstack/overview`,
    apiBase: 'https://api.opencapstack.com/api/v1',
    // OpenCapStack MCP — docs/AINATIVE_PRIMITIVES.md §4 (JWT bearer + MCP). Tool
    // count not published in §6; left undefined.
    mcpUrl: `${MCP_BASE}/opencapstack`,
    triggers: ['equity', 'cap table', 'captable', 'fundraising', 'fundraise', 'safe', 'investors', 'shares', 'vesting', 'valuation', 'dilution', 'startup equity'] },
  { name: 'ServiceOS', category: 'business-ops',
    purpose: 'Helpdesk / customer-service operations: tickets, queues, agent workflows',
    url: `${DOCS}/business-ops/serviceos`,
    apiBase: 'https://helpdesk.ainative.studio/api',
    triggers: ['support', 'helpdesk', 'help desk', 'tickets', 'customer service', 'service', 'complaints', 'faq'] },
  { name: 'Content Workflow', category: 'business-ops',
    purpose: 'AI content + distribution: personas, scheduled posts, auto-captions, avatar videos, auto-publish',
    url: `${DOCS}/api/content-workflow`,
    apiBase: 'https://api.ainative.studio/api/v1/public',
    // Strapi MCP (21 tools) — docs/AINATIVE_PRIMITIVES.md §6. Stands up / operates a
    // real CMS for content-driven apps agentically.
    mcpUrl: `${MCP_BASE}/strapi`,
    mcpTools: 21,
    triggers: ['content', 'marketing', 'social', 'social media', 'posts', 'blog', 'creator', 'captions', 'newsletter', 'campaigns', 'seo', 'brand awareness'] },
  { name: 'Live Streaming', category: 'business-ops',
    purpose: 'Streams (RTMPS in / HLS out), real-time chat, VOD, audience analytics, WebRTC',
    url: `${DOCS}/live-streaming/overview`,
    apiBase: 'https://api.ainative.studio',
    triggers: ['stream', 'streaming', 'live', 'video', 'broadcast', 'webinar', 'events', 'twitch'] },
  { name: 'Intent-Casting Marketplace', category: 'business-ops',
    purpose: 'Two-sided marketplace: agents broadcast goals, businesses respond with agent-readable services',
    url: `${DOCS}/marketplace/overview`,
    apiBase: 'https://api.ainative.studio/v1/public/intents',
    triggers: ['marketplace', 'two-sided', 'match', 'matching', 'buyers and sellers', 'services', 'gig', 'booking'] },
  { name: 'AINativeNGO', category: 'business-ops',
    // "InstitutionOS" — 8-layer OS for AI-native institutions. Live API verified at
    // ngo.ainative.studio (openapi.json, 360 endpoints): grants, impact, donors,
    // board/board-memory, compliance, federation, specialized-agents, retention.
    purpose: 'Nonprofit / NGO operations (InstitutionOS): donors, donations, grants, impact reporting, board governance, compliance, volunteers',
    url: `${DOCS}/ngo/overview`,
    apiBase: 'https://ngo.ainative.studio/api/v1',
    triggers: ['nonprofit', 'non-profit', 'ngo', 'charity', 'charitable', 'donation', 'donate', 'donor', 'donors', 'fundraiser', 'fundraising', 'grant', 'grants', 'grant management', 'volunteer', 'volunteers', 'philanthropy', 'impact', 'foundation', 'institution'] },
  { name: 'Browser Agent', category: 'business-ops',
    purpose: 'Web data extraction + browser automation (MCP)',
    url: `${DOCS}/business-ops/browser-agent`,
    sdk: '@ainative/browser-mcp',
    // Browser Agent ships as an MCP server via `npx @ainative/browser-mcp` (stdio) —
    // docs/AINATIVE_PRIMITIVES.md §3. Carry the doc pointer; transport is stdio, not HTTP.
    mcpUrl: `${DOCS}/business-ops/browser-agent`,
    triggers: ['scrape', 'scraping', 'extract', 'crawl', 'browser automation', 'web data', 'monitor prices', 'aggregat'] },

  // ---- Data / AI supporting primitives (idea-gated) ----
  { name: 'Context Graph', category: 'data-memory',
    purpose: 'Knowledge-graph layer over ZeroMemory: entities, edges, multi-hop traversal — models the social graph (users ↔ connections)',
    url: `${DOCS}/api/context-graph`,
    triggers: ['knowledge graph', 'relationships', 'entities', 'graph', 'connections',
      'social graph', 'social', 'followers', 'follower', 'following', 'friends', 'friend', 'network', 'profiles', 'profile'] },
  { name: 'Search & Discovery', category: 'data-memory',
    purpose: 'Unified search (users/posts/groups/events) + semantic search, autocomplete, trending, recommendations — powers the feed and people-discovery',
    url: `${DOCS}/search/overview`,
    triggers: ['search', 'discovery', 'recommendations', 'recommend', 'browse', 'find', 'autocomplete', 'feed',
      'social', 'community', 'people', 'discover people', 'groups', 'trending', 'explore'] },
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

  // ---- Community / social primitives (idea-gated) — docs/AINATIVE_PRIMITIVES.md §9 ----
  { name: 'Social Graph', category: 'community',
    purpose: 'Social graph: followers, following, friendships/connections, block/ignore — the relationship layer for a social app',
    url: `${DOCS}/community/social-graph`,
    apiBase: 'https://api.ainative.studio/api/v1',
    triggers: ['social graph', 'social', 'social network', 'social media', 'followers', 'follower', 'following',
      'follow', 'friends', 'friend', 'connections', 'connect', 'network', 'block', 'community'] },
  { name: 'Community', category: 'community',
    purpose: 'Community / collaborative APIs: groups, membership, events, social feeds and interactions',
    url: `${DOCS}/community/overview`,
    apiBase: 'https://api.ainative.studio/api/v1',
    triggers: ['community', 'social', 'social network', 'social media', 'groups', 'group', 'members', 'membership',
      'forum', 'collaborative', 'feed', 'posts', 'comments', 'notifications', 'notify', 'messaging', 'people'] },
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

/**
 * MCP-server metadata (#73). Descriptor for an AINative MCP server the agent can
 * connect to. Catalog primitives carry `mcpUrl`/`mcpTools`; some published servers
 * (PRD Generator, Sequential Thinking, Design System, GTM) are build/ops tools
 * that don't map 1:1 to a composable catalog primitive — they live in
 * MCP_SERVERS below so the multi-server client can still discover them.
 */
export interface McpServerRef {
  /** Stable id used to select the server (e.g. 'zerodb'). */
  id: string
  /** Human label. */
  label: string
  /** Streamable-HTTP endpoint, or a doc pointer for stdio/npx servers. */
  url: string
  /** Published tool count from docs/AINATIVE_PRIMITIVES.md §6 (undefined if not published). */
  tools?: number
  /** Catalog primitive this server operates, when there is one. */
  primitive?: string
  /** Transport kind — HTTP servers are directly connectable; stdio servers are npx-launched. */
  transport: 'http' | 'stdio'
}

/**
 * The published AINative MCP fleet (docs/AINATIVE_PRIMITIVES.md §6). Single source
 * of truth for WHICH servers the multi-server client can connect to. HTTP servers
 * are keyed off MCP_BASE so one env var retargets the fleet.
 */
export const MCP_SERVERS: McpServerRef[] = [
  { id: 'zerodb', label: 'Full ZeroDB MCP', url: `${MCP_BASE}/zerodb`, tools: 69, primitive: 'ZeroDB', transport: 'http' },
  { id: 'memory', label: 'Memory MCP', url: `${MCP_BASE}/memory`, tools: 18, primitive: 'ZeroMemory', transport: 'http' },
  { id: 'prd-generator', label: 'PRD Generator MCP', url: `${MCP_BASE}/prd-generator`, tools: 18, transport: 'http' },
  { id: 'sequential-thinking', label: 'Sequential Thinking MCP', url: `${MCP_BASE}/sequential-thinking`, transport: 'http' },
  { id: 'design-system', label: 'Design System MCP', url: `${MCP_BASE}/design-system`, tools: 3, transport: 'http' },
  { id: 'strapi', label: 'Strapi MCP', url: `${MCP_BASE}/strapi`, tools: 21, primitive: 'Content Workflow', transport: 'http' },
  { id: 'zerovoice', label: 'ZeroVoice MCP', url: `${MCP_BASE}/zerovoice`, tools: 25, primitive: 'ZeroVoice', transport: 'http' },
  // GTM ships via `@ainative/gtm-mcp` (stdio) — carry the doc overview as its pointer.
  { id: 'gtm', label: 'GTM MCP', url: `${DOCS}/mcp/gtm-server`, primitive: 'Content Workflow', transport: 'stdio' },
]

const MCP_SERVERS_BY_ID = new Map(MCP_SERVERS.map((s) => [s.id, s]))

/** Look up a published MCP server descriptor by id. */
export function getMcpServer(id: string): McpServerRef | undefined {
  return MCP_SERVERS_BY_ID.get(id)
}

/**
 * Catalog primitives that are MCP-operable (carry an `mcpUrl`). Feeds the
 * "operated via MCP — your agent can drive this too" surfacing (#66 owns the
 * chips) and lets the build path know which primitives Cody can provision/operate
 * agentically rather than only emit REST calls for.
 */
export function getMcpOperablePrimitives(): CatalogPrimitive[] {
  return CATALOG.filter((p) => !!p.mcpUrl)
}

/** True if a primitive (by name) is operable via an MCP server. */
export function isMcpOperable(name: string): boolean {
  return !!CATALOG_BY_NAME.get(name)?.mcpUrl
}

/**
 * Resolve a chip label to its one-line purpose string for the hover tooltip
 * (#66). Chip labels in PRIMITIVE_MAP can be decorated (e.g. "ZeroDB · Vectors",
 * "AI Kit Safety") — so we try an exact hit first, then a prefix/stem match
 * against the catalog name, so every chip gets a description pulled from the
 * catalog rather than hardcoded per component.
 *
 * Returns undefined only when no catalog entry can be matched (e.g. internal
 * entries like "GraphRAG", "Sequential Thinking" that aren't public primitives).
 */
export function getPrimitiveTooltip(chipLabel: string): string | undefined {
  // 1. Exact match (fast path).
  const exact = CATALOG_BY_NAME.get(chipLabel)
  if (exact) return exact.purpose

  // 2. Decorated-name match: "ZeroDB · Vectors" → try "ZeroDB".
  //    Strip anything after " · " or " - " to get the stem.
  const stem = chipLabel.split(/\s[·\-]\s/)[0].trim()
  if (stem !== chipLabel) {
    const byStem = CATALOG_BY_NAME.get(stem)
    if (byStem) return byStem.purpose
  }

  // 3. Longest-prefix match: "AI Kit Safety" → "AI Kit" (walk the catalog,
  //    keep the longest catalog name that is a prefix of the chip label).
  let bestMatch: CatalogPrimitive | undefined
  let bestLen = 0
  for (const [catalogName, primitive] of CATALOG_BY_NAME) {
    if (chipLabel.startsWith(catalogName) && catalogName.length > bestLen) {
      bestMatch = primitive
      bestLen = catalogName.length
    }
  }
  if (bestMatch) return bestMatch.purpose

  // 4. Substring: chip label contains a catalog name (case-insensitive).
  for (const [catalogName, primitive] of CATALOG_BY_NAME) {
    if (chipLabel.toLowerCase().includes(catalogName.toLowerCase())) {
      return primitive.purpose
    }
  }

  return undefined
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

/**
 * MCP real-data provisioning paragraph (#343) — appended to the AGENT system
 * prompt (lib/agent/claude-agent.ts) when the spawned agent actually has the
 * ZeroDB MCP server wired (buildAgentMcpWiring). The agent has had 69+ live
 * mcp__zerodb__* tools since #296, but no prompt ever instructed their use —
 * so every data-backed build shipped with mock-feel data and zero organic MCP
 * usage. This paragraph closes that gap: for any app that persists records,
 * the agent must CREATE the real tables and SEED 5-10 realistic records at
 * build time, so the first thing a founder sees is a live app with real data.
 *
 * Only inject this when MCP wiring is live — telling a plain completion model
 * (no tool_use) to call MCP tools makes it hallucinate tool syntax into code.
 */
export function mcpDataProvisioningBlock(): string {
  return (
    `REAL DATA VIA MCP (MANDATORY for any app that reads/writes records):\n` +
    `You have live mcp__zerodb__* tools — use them to provision the app's REAL data layer before you finish:\n` +
    `1. For EACH table the app touches through /api/db/{table}, call mcp__zerodb__zerodb_create_table with table_name set to exactly that {table} segment (e.g. the app fetches /api/db/tasks → table_name "tasks").\n` +
    `2. Seed 5-10 REALISTIC records into each primary table with mcp__zerodb__zerodb_insert_rows — plausible domain data (real-looking names, dates, amounts, statuses that match the app's subject), NEVER "Test 1"/"foo"/"Lorem". Row field names MUST exactly match the fields the app's code reads.\n` +
    `3. Do NOT hardcode those records in the app code. The app loads them at runtime via GET /api/db/{table} — the seeded rows are what a first-time user sees, and their edits persist to the same table.\n` +
    `Your MCP connection targets the shared preview ZeroDB project (the same one /api/db serves for un-provisioned apps), so seeded rows appear in the running preview.\nIMPORTANT — attempt once, never loop: if an mcp__zerodb__ call errors, do NOT retry it more than once total. Fall back immediately: tables auto-create on the app's first POST /api/db/{table} insert, so seed by having the app itself write realistic starter records on first load when its GET returns empty. Never burn turns on failing MCP calls.\n` +
    `Skip this ONLY when the app genuinely persists nothing (e.g. a pure calculator). MCP tool calls are allowed and expected — they are not shell commands.`
  )
}

/**
 * CODEGEN composition block (#218) — the other half of #288's selection.
 *
 * #288 wired selection (WHICH primitives) into the artifact/summary prompts.
 * This block goes into the CODE-GENERATION system prompt so the generated app
 * actually WIRES UP the real primitive REST/SDK surfaces (with concrete base
 * URLs) INSTEAD of hand-rolling business logic (invoicing, CRM, commerce,
 * telephony, cap-table, etc.). That composition — calling AINative products
 * rather than regenerating fragile CRUD — is the moat vs. generic app builders.
 *
 * It lists ONLY the primitives selected for this idea that expose a real
 * endpoint/SDK, so the model gets the concrete URL to fetch() against.
 */
export function codegenCompositionBlock(idea: string, track: 'app' | 'company' = 'company'): string {
  const { foundational, selected } = selectPrimitives(idea, track)
  // Wire foundational substrate first, then the idea-matched business-ops layer.
  const wireable = [...foundational, ...selected].filter((p) => p.apiBase || p.sdk)
  // De-dup by name (foundational + selected can't overlap, but be safe).
  const seen = new Set<string>()
  const lines: string[] = []
  for (const p of wireable) {
    if (seen.has(p.name)) continue
    seen.add(p.name)
    const how = p.apiBase
      ? `call its REST API at \`${p.apiBase}\` (Authorization: Bearer <AINATIVE_API_KEY>)`
      : `import its SDK \`${p.sdk}\``
    // #314/#315: carry the plain-English "already included — no extra key/cost —
    // replaces {commercial tool}" framing so the generated app proactively tells
    // the user they already have this built-in (e.g. "replaces HubSpot").
    const framing = includedFramingForPrimitive(p.name)
    const included = framing ? ` (${framing})` : ''
    lines.push(`- ${p.name}${included} — ${p.purpose}. To use: ${how}. Docs: ${p.url}`)
  }
  if (lines.length === 0) {
    // No wireable primitive matched — still steer the model toward AI Kit + ZeroDB.
    lines.push(
      `- AI Kit — import its SDK \`@ainative/ai-kit-core\` for UI components (do not hand-build chat/tables/cards).`,
      `- ZeroDB — persist all app data via its REST API at \`https://api.ainative.studio/api/v1\` (Authorization: Bearer <AINATIVE_API_KEY>).`,
    )
  }
  return (
    `## COMPOSE WITH REAL AINATIVE PRIMITIVES (MANDATORY — do NOT re-implement business logic)\n\n` +
    `This app must be BUILT ON AINative's real products, not a from-scratch clone. When a primitive below covers a capability the app needs (invoicing, CRM/sales, ecommerce/checkout, telephony/SMS, cap-table/equity, helpdesk, content/social, streaming, marketplace), you MUST call that primitive's real endpoint/SDK instead of hand-rolling the logic:\n\n` +
    lines.join('\n') + '\n\n' +
    // FOUNDATIONAL (#298): every app gets ZeroDB (via the same-origin proxy) + a
    // lightweight auth pattern by DEFAULT — these are non-optional, regardless of
    // which SaaS primitives matched. The /api/db proxy is the ONLY data path that
    // works from a generated app (same-origin, server holds the key); direct
    // primitive Bearer calls auth-fail client-side, so we anchor persistence here.
    `### FOUNDATION — ALWAYS WIRE THESE (every app):\n` +
    `- DATA (ZeroDB): persist ALL app records via the same-origin proxy — never an in-memory store, never a direct external DB:\n` +
    `    GET  /api/db/{table}            → list rows (returns { data: [ {id, ...fields} ] })\n` +
    `    POST /api/db/{table}            → insert (body = the row object; returns the flat row with an id)\n` +
    `    PUT  /api/db/{table}?id={id}    → update    DELETE /api/db/{table}?id={id} → delete\n` +
    `    GET  /api/db/{table}?search={text}  → SEMANTIC search (returns { results: [...] }); use this for\n` +
    `        "search"/"find similar" features — do NOT hand-roll client-side text filtering for semantic search.\n` +
    `  Load on mount with useEffect; re-fetch or update state after writes. Rows come back FLAT with an \`id\`.\n` +
    `  Tables MAY be pre-seeded with real records at build time (#343) — on first load, render\n` +
    `  whatever GET /api/db/{table} returns as the source of truth. Do NOT ship a hardcoded mock array as the\n` +
    `  data source; at most use a tiny inline fallback ONLY when the fetch itself fails.\n` +
    `- AUTH (lightweight, no backend): if the app has per-user data, scope it to a user id kept in localStorage\n` +
    `  (e.g. \`let uid = localStorage.getItem('uid') || crypto.randomUUID(); localStorage.setItem('uid', uid)\`),\n` +
    `  store \`userId: uid\` on each row, and filter reads with \`/api/db/{table}?filter=\${encodeURIComponent(JSON.stringify({userId: uid}))}\`.\n` +
    `  For a real login screen, render an email+continue form that sets that uid — do NOT call an external auth API.\n\n` +
    `Rules:\n` +
    `1. Import \`@ainative/ai-kit-core\` (and its React bindings) for UI primitives — do NOT rebuild chat, tables, product cards, or dashboards from scratch when an AI Kit component exists.\n` +
    `2. Persist through /api/db (above) — this is MANDATORY when the app saves any records. The generated app runs in the browser, so it does NOT have AINATIVE_API_KEY; NEVER put a Bearer key or secret in app code. The SaaS primitive endpoints listed above are called SERVER-SIDE only (by the platform), not from generated app code.\n` +
    `3. Do NOT reimplement invoicing, CRM, ecommerce carts/checkout, telephony, cap-table math, or helpdesk ticketing when the matching primitive exists — model the app around composing it. Regenerating that business logic from scratch is a FAILING score.\n` +
    `4. Add a short comment above each data call noting the AINative product it composes (e.g. \`// ZeroDB — orders\`), so the wiring is auditable.\n` +
    // #314/#315: the "already included / replaces X" framing above is a SELLING
    // POINT — surface it to the user, don't bury it. When a feature is powered by
    // one of these primitives, tell them in plain English they already have it.
    `5. Where a primitive above is marked "already included (no extra API key, no extra cost) — replaces {commercial tool}", surface that to the user in plain English where the feature lives (e.g. a caption or tooltip: "Billing is built-in — no extra key, replaces Stripe Invoicing"). Do NOT tell the user to sign up for or pay for the tool it replaces.` +
    // #83 (Phase 7c): traverse the primitive/component graph so the model gets the
    // CONCRETE AIKit components this archetype's surfaces need (attacks aikit=0%).
    componentGuidanceBlock(idea)
  )
}
