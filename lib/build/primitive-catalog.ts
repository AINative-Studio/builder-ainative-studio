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
   * `true` = every track (app + company). `'company'` = only the company
   * track, where `app/api/build/provision/route.ts` genuinely, unconditionally
   * provisions the resource for every checkout (e.g. OpenCapStack's real cap
   * table — #427 provisions it best-effort for every company, not just
   * equity/fundraising-triggered ideas, so Cody/the UI must surface it the
   * same way, not gate it behind trigger words a founder may never type).
   */
  foundational?: boolean | 'company'
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
    // NOT setting mcpUrl/mcpTools here (#534): docs/AINATIVE_PRIMITIVES.md §6
    // documents a "Memory MCP" (18 tools) at MCP_BASE/memory, but that host is
    // confirmed DEAD via live curl (404 on every tested path, served by
    // builder's own SPA catch-all, not an MCP handler) — same pattern as the
    // OpenCapStack fix (#429/#413). No stdio-npm alternative is known to exist
    // for ZeroMemory either, unlike ZeroDB's real `ainative-zerodb-mcp-server`.
    // Refs core#6667 (the hosted MCP gateway epic) — re-verify live before
    // ever re-adding this field.
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
    // Real live host confirmed via live probe (#415): api.ainative.studio does
    // NOT proxy ZeroVoice's own routes at all (404, route doesn't exist there);
    // the real, auth-gated, working host is ZeroVoice's own Railway service.
    apiBase: 'https://zerovoice-production.up.railway.app/api/v1',
    // NOT setting mcpUrl/mcpTools here (#534): docs/AINATIVE_PRIMITIVES.md §6
    // documents a "ZeroVoice MCP" (25 tools) at MCP_BASE/zerovoice, but that
    // host is confirmed DEAD via live curl (404 on every tested path, served
    // by builder's own SPA catch-all, not an MCP handler) — same pattern as
    // the OpenCapStack fix (#429/#413). No stdio-npm alternative is known to
    // exist for ZeroVoice either, unlike ZeroDB's real
    // `ainative-zerodb-mcp-server`. Refs core#6667 (the hosted MCP gateway
    // epic) — re-verify live before ever re-adding this field.
    // #522: 'call'/'calls' were dropped as bare triggers — scorePrimitives'
    // matching (lib/build/primitive-catalog.ts's scorePrimitives) falls back
    // to a plain substring check with no word-boundary guard, so a bare
    // 'call' trigger false-matched ANY idea containing "recall", "called", or
    // "calling" (e.g. a journaling app that "recalls relevant history" —
    // real regression this fix surfaced in __tests__/lib/build/obedience-gate.test.ts).
    // Kept only phrases specific enough not to collide with common English.
    triggers: ['phone call', 'phone calls', 'outbound call', 'cold calling', 'phone', 'sms', 'text message', 'voice', 'telephony', 'ivr', 'dial', 'cold call', 'appointment reminder'] },
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
    // Real live route is /v1/* (no /api prefix) — confirmed via live probe
    // (#421): /api/v1/forms 404s, /v1/forms correctly 401s with "Invalid or
    // unauthorized AINative API key". The old apiBase had an extra /api segment.
    apiBase: 'https://zeroforms-production.up.railway.app/v1',
    triggers: ['form', 'forms', 'survey', 'intake form', 'signup form', 'contact form', 'questionnaire', 'submission', 'webhook'] },
  { name: 'ZeroBooks', category: 'business-ops',
    purpose: 'AI-native accounting + bookkeeping: transparent pricing, agent-first UX, ZeroDB-backed',
    url: `${DOCS}/business-ops/zerobooks`,
    apiBase: 'https://zerobooks-production.up.railway.app/api/v1',
    triggers: ['accounting', 'bookkeeping', 'ledger', 'chart of accounts', 'financial statements', 'expenses', 'reconciliation'] },
  { name: 'AgentFlow', category: 'agent-cloud',
    purpose: 'No-code visual builder for AI agent workflows: build, run, and stream agent flows',
    url: `${DOCS}/agent-cloud/agentflow`,
    // Real apiBase re-verified (#443 follow-up) against AgentFlow's live
    // root openapi.json (title: "AgentFlow", real path /api/v1/projects/) —
    // a prior pass here claimed a /build prefix, but that path 200s only
    // because it falls through to the SPA's HTML shell, not a real route;
    // the genuine API is the plain /api/v1 prefix, confirmed via a real
    // POST to /api/v1/projects/ returning a structured FastAPI auth-reject
    // JSON body, matching lib/build/agentflow.ts's own AF_BASE.
    apiBase: 'https://agentflow.ainative.studio/api/v1',
    triggers: ['visual agent builder', 'no-code agent', 'workflow builder', 'agent workflow', 'drag and drop agent', 'flow builder'] },
  { name: 'QNN API', category: 'ai-inference',
    purpose: 'Train and run Quantum Neural Networks via API (moonshot-stage)',
    url: `${DOCS}/moonshots/qnn-api`,
    apiBase: 'https://qnn.ainative.studio/api/v1',
    triggers: ['quantum', 'quantum computing', 'quantum neural network', 'qnn', 'quantum machine learning'] },
  { name: 'Ocean', category: 'data-memory',
    // Confirmed via its own openapi.json (45 real endpoints: blocks/pages/tags/
    // semantic search) — this is the real "oceanapi.ainative.studio" service
    // (Railway: ocean-backend, repo AINative-Studio/ocean-backend). Previously
    // mislabeled "SpaceTime OS" in this catalog (#425) — unrelated to the real
    // SpaceTime OS / Sentinel OS primitive below.
    purpose: 'Knowledge & action workspace: blocks, links, pages, semantic content organization',
    url: `${DOCS}/data-memory/ocean`,
    apiBase: 'https://oceanapi.ainative.studio/api/v1',
    triggers: ['knowledge base', 'wiki', 'notes', 'notion-like', 'blocks', 'linked notes', 'knowledge management', 'second brain'] },
  { name: 'SpaceTime OS', category: 'business-ops',
    // Real service: Railway `sentinel-os-api` (repo AINative-Studio/spacetime-os),
    // live at sentinel-os-api-production.up.railway.app / api.usesentinel.io —
    // confirmed via its own openapi.json. Publicly branded "SpaceTime OS" (repo
    // root ships SpaceTime_OS_Whitepaper_2026.pdf, "Built by SpaceTime
    // Industries"); the codebase's internal name is "Sentinel OS". A
    // vertical-specific critical-infrastructure platform (cable infrastructure /
    // port security) — its POST /api/v1/tenants requires a SUPER_ADMIN role, not
    // a founder-JWT-reusable self-serve flow like most other primitives here, so
    // deliberately NOT `foundational` — surfaced to Cody only for a
    // security/infrastructure-vertical idea, never auto-provisioned (#422).
    purpose: 'Critical-infrastructure protection & response orchestration (cable infrastructure, port security)',
    url: `${DOCS}/business-ops/spacetime-os`,
    apiBase: 'https://sentinel-os-api-production.up.railway.app/api/v1',
    triggers: ['critical infrastructure', 'infrastructure protection', 'cable infrastructure', 'port security', 'sensor network', 'threat detection', 'security orchestration'] },
  { name: 'OpenCapStack', category: 'business-ops', foundational: 'company',
    // #427 provisions a real cap table for EVERY company unconditionally at
    // checkout (app/api/build/provision/route.ts, best-effort via a builder
    // service account — no founder JWT or idea-matched trigger needed). Since
    // it's always real, it must always be surfaced to Cody/the UI on the
    // company track too — not gated behind equity/fundraising trigger words a
    // founder building e.g. a coffee-shop app would never type.
    purpose: 'Cap table + equity (OCTA): stakeholders, SAFEs, grants, vesting, waterfall, investor portals',
    url: `${DOCS}/opencapstack/overview`,
    apiBase: 'https://api.opencapstack.com/api/v1',
    // OpenCapStack MCP is the real, published `@opencapstack/mcp-server` npm
    // package (npx-launched, stdio by default; 27 tools) — verified live (#413).
    // It is NOT a hosted server behind mcp.ainative.studio: MCP_BASE/opencapstack
    // 301-redirects into builder's own SPA rather than serving MCP protocol
    // (core#6667). Registered in MCP_SERVERS below with a doc-page pointer,
    // matching the existing GTM (stdio) entry's pattern.
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
    // NOT setting mcpUrl/mcpTools here (#534): docs/AINATIVE_PRIMITIVES.md §6
    // documents a "Strapi MCP" (21 tools) at MCP_BASE/strapi, but that host is
    // confirmed DEAD via live curl (404 on every tested path, served by
    // builder's own SPA catch-all, not an MCP handler) — same pattern as the
    // OpenCapStack fix (#429/#413). No stdio-npm alternative is known to
    // exist for this primitive either, unlike ZeroDB's real
    // `ainative-zerodb-mcp-server`. Refs core#6667 (the hosted MCP gateway
    // epic) — re-verify live before ever re-adding this field.
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
    // Real, live REST API confirmed (#411/#413): GET .../health lists real
    // endpoints (act, extract, validate, task, extract-to-table,
    // enrich-memory, batch-extract, enrich-memory-async).
    apiBase: 'https://api.ainative.studio/api/v1/public/browser',
    // NOTE (#413): this primitive ALSO ships as an MCP server via
    // `npx @ainative/browser-mcp` (stdio) — docs/AINATIVE_PRIMITIVES.md §3 —
    // but that's a locally-spawned stdio process, not a URL, and was
    // previously mis-set here as `mcpUrl: <a docs page>`, which isn't a real
    // server endpoint and was never registered in MCP_SERVERS either.
    // Deliberately not setting mcpUrl / registering it there: use the real
    // REST apiBase above for HTTP-based composition instead.
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
    apiBase: 'https://api.ainative.studio',
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
    // Runtime proxy at /api/model-catalog/list (#505/#508) — see route.ts for
    // why only `list` is wired (single-model lookup's real id contract is
    // unconfirmed). apiBase kept for consistency with other proxied
    // primitives; the generated app never calls it directly.
    apiBase: 'https://api.ainative.studio/api/v1/public/models',
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
  // ---- Payments / monetization (idea-gated) ----
  { name: 'Agent402', category: 'auth-billing',
    purpose: 'Agentic (machine-to-machine) payments over Web3',
    url: `${DOCS}/web3/agent402`,
    // Real backend confirmed live (#411) — agent402.ainative.studio is the
    // frontend SPA (every path resolves to the same shell); the real API is
    // the separate Agent-402 Railway service, self-identified as "ZeroDB
    // Agent Finance API". Real routes are mixed-prefix (some at root, e.g.
    // /activity, /anchor/*; some under /api/v1/*) — apiBase is the bare host.
    apiBase: 'https://agent-402-production.up.railway.app',
    triggers: ['agentic payments', 'machine payments', 'x402', 'agent pays', 'pay per call', 'micropayments'] },
  { name: 'Developer Program', category: 'auth-billing',
    purpose: 'Let the app monetize itself: 0–40% markup + Stripe Connect payouts',
    url: `${DOCS}/developer-program/overview`,
    // Real routes confirmed live via core's own openapi.json (#411):
    // /api/v1/public/developer/{payouts,earnings,analytics,logs}/*.
    apiBase: 'https://api.ainative.studio/api/v1/public/developer',
    triggers: ['monetize', 'marketplace payout', 'revenue share', 'stripe connect', 'sell api', 'developer earnings'] },
]

/**
 * Company-track role selection (#448) — decomposes "build a company" from
 * one monolithic build into a specific function a founder can pick, so the
 * outcome is legible ("this builds your Marketing operation") instead of an
 * undifferentiated "company" with no defined deliverable.
 *
 * Deliberately a NAME-based boost list, not `category`-based: every
 * business-ops primitive shares one category, so a category filter can't
 * distinguish "Sales" (ZeroPipeline/ZeroInvoice/ZeroCommerce) from
 * "Marketing" (Content Workflow/Live Streaming) — they're both
 * `business-ops`. Real primitive names are the only thing that actually
 * differentiates a role.
 */
export type CompanyRole = 'marketing' | 'sales' | 'operations'

export const COMPANY_ROLES: { id: CompanyRole; label: string; description: string }[] = [
  { id: 'marketing', label: 'Marketing', description: 'Content, outreach, and audience growth — Content Workflow, Live Streaming, market research' },
  { id: 'sales', label: 'Sales', description: 'Pipeline, invoicing, and storefront — ZeroPipeline, ZeroInvoice, ZeroCommerce' },
  { id: 'operations', label: 'Operations', description: 'Resource planning, support, and back-office — ZeroERP, ServiceOS, ZeroForms, ZeroBooks' },
]

/** Real catalog names each role emphasizes. Kept as a plain record (not derived
 *  from `category`) so each role stays precisely scoped as the catalog grows. */
const ROLE_PRIMITIVE_NAMES: Record<CompanyRole, string[]> = {
  marketing: ['Content Workflow', 'Live Streaming', 'Data Marketplace', 'ZeroVoice'],
  sales: ['ZeroPipeline', 'ZeroInvoice', 'ZeroCommerce', 'ZeroVoice'],
  operations: ['ZeroERP', 'ServiceOS', 'ZeroForms', 'ZeroBooks'],
}

/**
 * True when `role` is a real role, `track` is 'company' (roles are a
 * company-track concept only — the app track has no provisioning-time role
 * distinction to back it), and `primitive` is one of that role's named picks.
 * Centralized here (not duplicated at each call site) so every caller gets
 * the track guard for free — an earlier draft of this feature forgot the
 * guard in `selectPrimitives`'s filter and let a role leak into app-track
 * selections; caught by this file's own test suite before it shipped.
 */
function isRoleEmphasized(primitive: CatalogPrimitive, track: 'app' | 'company', role: CompanyRole | undefined): boolean {
  if (!role || track !== 'company') return false
  return ROLE_PRIMITIVE_NAMES[role]?.includes(primitive.name) ?? false
}

/** Fast lookup by name; also guards against any accidental duplicate entry
 *  in PRIMITIVE_CATALOG (first occurrence wins) — see #412. */
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
 *
 * REALITY CHECK (#534): every `transport: 'http'` entry below (zerodb, memory,
 * prd-generator, sequential-thinking, design-system, strapi, zerovoice) points
 * at MCP_BASE (mcp.ainative.studio), which is confirmed DEAD via live curl —
 * real 404s on all of them, served by builder's own SPA catch-all, not an MCP
 * handler (Refs core#6667, still open). `getMcpServer('zerodb')` is still
 * referenced from `lib/build/mcp-provision.ts`, but that wedge is inert by
 * default (ENABLE_MCP_PROVISION unset) and fails closed to the existing REST
 * fallback when the dead host 404s — it does not surface a false "connected"
 * state. The ONE genuinely live ZeroDB MCP path in production is a completely
 * different mechanism: `lib/agent/agent-runtime.ts`'s `buildAgentMcpWiring()`,
 * which spawns the real stdio npm package `ainative-zerodb-mcp-server`
 * directly — it does not read this array at all. Do not treat an `http` entry
 * here as evidence any of these servers are reachable; re-verify live via curl
 * before wiring a real caller to one.
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
  // OpenCapStack ships via `@opencapstack/mcp-server` (stdio, npx-launched) —
  // real published package verified live (#413); no AINative-hosted HTTP URL
  // exists for it (mcp.ainative.studio/opencapstack is broken — core#6667).
  { id: 'opencapstack', label: 'OpenCapStack MCP', url: `${DOCS}/opencapstack/overview`, tools: 27, primitive: 'OpenCapStack', transport: 'stdio' },
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
/**
 * True when a primitive's `foundational` flag applies on the given track.
 *
 * OpenCapStack is a special case (#443 follow-up): #427 auto-provisions a
 * real cap table for every company unconditionally, so it's genuine
 * company-track substrate — EXCEPT when the idea reads as nonprofit-shaped,
 * where AINativeNGO (donors/grants/impact, not startup equity) is the real
 * fit (#302). Detected by AINativeNGO's own triggers matching the idea,
 * rather than a second hardcoded keyword list, so the two carve-outs can't
 * drift apart.
 */
function isFoundationalOnTrack(primitive: CatalogPrimitive, track: 'app' | 'company', idea: string): boolean {
  if (primitive.name === 'OpenCapStack' && track === 'company') {
    const hay = ` ${(idea || '').toLowerCase()} `
    const ngo = CATALOG.find((p) => p.name === 'AINativeNGO')
    const isNonprofitIdea = ngo?.triggers.some((t) => hay.includes(` ${t}`) || hay.includes(`${t} `) || hay.includes(t)) ?? false
    return !isNonprofitIdea
  }
  if (primitive.foundational === true) return true
  if (primitive.foundational === 'company') return track === 'company'
  return false
}

export function scorePrimitives(
  idea: string,
  track: 'app' | 'company' = 'company',
  role?: CompanyRole,
): PrimitiveScore[] {
  const hay = ` ${(idea || '').toLowerCase()} `
  return CATALOG.map((primitive) => {
    const matched = primitive.triggers.filter((t) => hay.includes(` ${t}`) || hay.includes(`${t} `) || hay.includes(t))
    let score = matched.length
    if (isFoundationalOnTrack(primitive, track, idea)) score += 0.5 // floor so substrate always ranks
    // On the company track, the "run a company" business-ops layer is the whole
    // point — give it a slight nudge so a live company surfaces real ops.
    if (track === 'company' && primitive.category === 'business-ops') score += 0.25
    // #448: a selected role narrows "company" further — its named primitives
    // outrank the rest of business-ops so the build is legibly a Marketing/
    // Sales/Operations build, not an undifferentiated everything-at-once one.
    if (isRoleEmphasized(primitive, track, role)) score += 1
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
  role?: CompanyRole,
): SelectionResult {
  const scored = scorePrimitives(idea, track, role)
  const foundational = CATALOG.filter((p) => isFoundationalOnTrack(p, track, idea))
  const selected = scored
    .filter((s) => !isFoundationalOnTrack(s.primitive, track, idea) && (s.matched.length > 0 || isRoleEmphasized(s.primitive, track, role)))
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
export function catalogPromptBlock(idea: string, track: 'app' | 'company' = 'company', role?: CompanyRole): string {
  const { names } = selectPrimitives(idea, track, 6, role)
  const full = CATALOG.map((p) => `- ${p.name}: ${p.purpose}`).join('\n')
  const roleLine = role
    ? `\nThis is a ${COMPANY_ROLES.find((r) => r.id === role)?.label ?? role} build — lead with the primitives that power that function specifically.\n`
    : ''
  return (
    `AINATIVE PRIMITIVE CATALOG (compose from THESE real products — do not invent primitives):\n${full}\n${roleLine}\n` +
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
 * Primitives with a real, generated-app-callable runtime path today, mapped
 * to the "To use" instruction that path implies. Every other primitive with
 * an `apiBase` is provisioned SERVER-SIDE (at company checkout, using the
 * founder's own AINative identity or a builder-held service credential) but
 * has NO proxy route a browser-run generated app can call — a direct
 * client-side `fetch()` with a Bearer key fails 100% of the time (no key
 * ships to the browser). Telling the model to `fetch()` those directly
 * produced code that is guaranteed broken at runtime — see the investigation
 * that added this constant. AI Kit ships as an SDK import, not a fetch, so it
 * has no runtime-path problem either.
 *
 * ZeroDB/Instant DB: a durable service key builder holds forever backs
 * /api/db — the original, always-worked case.
 *
 * ZeroCommerce/ZeroPipeline/AgentFlow/ZeroForms (#443): "one store/pipeline/
 * project/form per owner user" — the resource is scoped to the FOUNDER'S own
 * AINative identity, not a separate service credential. Confirmed for
 * ZeroForms specifically via its real `get_current_user` source: an AINative
 * key resolves to a `User` scoped to THAT key's own `organization_id` — a
 * builder-held service key would create/read the SERVICE ACCOUNT's forms,
 * not the founder's company's, so the founder's own captured identity is
 * required, the same as the other three (no cheaper service-key shortcut
 * exists here). /api/primitive/{name}/{...path} closes that gap: builder
 * captures and durably refreshes a copy of the founder's tokens at
 * provision time (lib/build/primitive-credentials.ts) and proxies runtime
 * calls through them — same-origin, so the generated app never sees the
 * credential. AgentFlow's real base is confirmed via its live openapi.json
 * (/api/v1/projects/, NOT the /api/v1/build path a prior pass here had
 * guessed). ZeroForms' real base has no /api prefix (confirmed live: /v1/forms
 * 401s correctly, /api/v1/forms 404s).
 *
 * This covers the 4 originally-scoped founder-identity primitives from #443.
 *
 * ZeroMemory/Browser Agent/Agent402/OpenCapStack/Model Catalog/Developer
 * Program/Community/AINativeNGO (#496/#499/#500/#503/#505/#510): each got a
 * real, live, auth-gated `/api/{slug}/[action]/route.ts` proxy this session
 * — but adding the route alone did NOT make Cody's generated code call it.
 * This constant is the ONLY thing that puts a literal fetch() instruction in
 * the codegen prompt; being live-curlable is necessary but not sufficient.
 * Confirmed via a real, currently-passing test
 * (__tests__/lib/primitive-catalog-codegen.test.ts) that OpenCapStack was
 * being framed as "already provisioned server-side" — i.e. the model was
 * being told NOT to call its own live proxy. Same bug class as #443, just
 * one layer up: the backend existed, but nothing told the model it could
 * use it.
 *
 * #518 follow-up: even with the instruction textually correct, a real
 * production run for a journaling app that should have called
 * POST /api/memory/recall instead reimplemented "related memories" as
 * client-side keyword-overlap matching over rows already loaded from
 * /api/db — a hand-rolled substitute for the exact primitive it was told to
 * use, with zero calls to /api/memory/* anywhere in the generated source.
 * Prose-only instructions are too easy for the model to satisfy with a
 * lookalike reimplementation instead of the real call. Each entry below now
 * carries (a) a literal, copy-pasteable fetch() snippet showing the exact
 * call shape, and (b) explicit anti-pattern language naming the specific
 * hand-rolled substitute to avoid for that primitive, not just prose
 * describing the endpoint.
 */
const RUNTIME_PROXIED_PRIMITIVES: Record<string, (apiBase: string) => string> = {
  ZeroDB: () => `call its REST API at \`https://api.ainative.studio/api/v1\` (Authorization: Bearer <AINATIVE_API_KEY>)`,
  'Instant DB': () => `call its REST API at \`https://api.ainative.studio/api/v1\` (Authorization: Bearer <AINATIVE_API_KEY>)`,
  // #524: ZeroCommerce was one of the ORIGINAL 5 founder-scoped primitives
  // (#443) — trusted on faith since then, never behaviorally live-tested. A
  // real production run for a "handmade coffee mugs" shop idea produced
  // 76,015 chars of generated code that persisted the ENTIRE product catalog
  // + checkout through generic /api/db tables and called
  // /api/primitive/zerocommerce/ ZERO times, despite this instruction being
  // present in the composition block. Root cause: same as #518 (ZeroMemory)
  // — plain prose with no code fence/anti-pattern language is too easy for
  // the model to satisfy with a lookalike reimplementation instead of the
  // real call. Strengthened with the same treatment #521 gave the 8 newer
  // primitives: a literal, copy-pasteable fetch() snippet + an explicit
  // named anti-pattern to forbid, naming the EXACT failure mode observed.
  ZeroCommerce: () =>
    `call the same-origin proxy at \`/api/primitive/zerocommerce/{path}\` — NO Authorization header needed, the platform attaches the founder's real ZeroCommerce credential server-side; the path after \`zerocommerce/\` matches ZeroCommerce's own REST path exactly.\n` +
    '  Real call shape (copy this exactly, do not paraphrase — the store itself is provisioned once at checkout via POST /commerce/stores/onboard, confirmed live per #417; the generated app only ever reads/writes products, cart, and orders through this proxy):\n' +
    '  ```js\n' +
    "  // List products in this company's real ZeroCommerce catalog\n" +
    "  const res = await fetch('/api/primitive/zerocommerce/commerce/products')\n" +
    '  const { products } = await res.json() // real catalog rows, not a hardcoded array\n' +
    '\n' +
    "  // Create a checkout session for the current cart\n" +
    "  await fetch('/api/primitive/zerocommerce/commerce/checkout', {\n" +
    "    method: 'POST', headers: { 'Content-Type': 'application/json' },\n" +
    '    body: JSON.stringify({ items: cartItems }),\n' +
    '  })\n' +
    '  ```\n' +
    '  ANTI-PATTERN — FORBIDDEN: do NOT hand-roll a product catalog, shopping cart, or checkout using /api/db tables ' +
    'instead of calling the real ZeroCommerce proxy. If the feature is a product listing, cart, or checkout, it MUST ' +
    'call GET/POST /api/primitive/zerocommerce/commerce/{products,checkout} — persisting products/cart/orders through ' +
    'generic /api/db rows instead is a FAILING implementation even if the UI looks identical to the user.',
  // #525: AgentFlow shares the SAME confirmed gap — a real 83,084-char
  // generation for "a no-code visual agent workflow builder with drag and
  // drop flow building" never called /api/primitive/agentflow/ and had ZERO
  // /api/ references of any kind (didn't even fall back to /api/db). Same
  // fix shape as #524/#521: literal fetch() snippet + named anti-pattern.
  ZeroPipeline: () =>
    `call the same-origin proxy at \`/api/primitive/zeropipeline/{path}\` — NO Authorization header needed, the platform attaches the founder's real ZeroPipeline credential server-side; the path after \`zeropipeline/\` matches ZeroPipeline's own REST path exactly.\n` +
    '  Real call shape (copy this exactly, do not paraphrase — the default pipeline itself is provisioned once at checkout via POST /pipelines, confirmed live per #243; the generated app only ever reads/writes deals through this proxy):\n' +
    '  ```js\n' +
    "  // List this company's real deals/leads\n" +
    "  const res = await fetch('/api/primitive/zeropipeline/deals')\n" +
    '  const { deals } = await res.json() // real pipeline deals, not fabricated leads\n' +
    '\n' +
    "  // Create a new deal/lead\n" +
    "  await fetch('/api/primitive/zeropipeline/deals', {\n" +
    "    method: 'POST', headers: { 'Content-Type': 'application/json' },\n" +
    '    body: JSON.stringify({ name: dealName, stage: \'Lead\' }),\n' +
    '  })\n' +
    '  ```\n' +
    '  ANTI-PATTERN — FORBIDDEN: do NOT hand-roll a leads/deals table using /api/db tables instead of calling the real ' +
    'ZeroPipeline proxy. If the feature is a CRM/sales-pipeline surface (deals, leads, stages), it MUST call ' +
    'GET/POST /api/primitive/zeropipeline/deals — persisting deals through generic /api/db rows instead is a FAILING ' +
    'implementation even if the UI looks identical to the user.',
  AgentFlow: () =>
    `call the same-origin proxy at \`/api/primitive/agentflow/{path}\` — NO Authorization header needed, the platform attaches the founder's real AgentFlow credential server-side; the path after \`agentflow/\` matches AgentFlow's own REST path exactly.\n` +
    '  Real call shape (copy this exactly, do not paraphrase — a default project itself is provisioned once at checkout via POST /projects/, confirmed live via AgentFlow\'s own openapi.json per #419; the generated app only ever reads/writes agent workflows through this proxy):\n' +
    '  ```js\n' +
    "  // List this company's real AgentFlow projects (each project holds agent workflows)\n" +
    "  const res = await fetch('/api/primitive/agentflow/projects/')\n" +
    '  const projects = await res.json() // real AgentFlow projects, not a mocked list\n' +
    '  ```\n' +
    '  ANTI-PATTERN — FORBIDDEN: do NOT hand-roll a fake "agent workflow" list or simulate flow execution with local ' +
    'state instead of calling the real AgentFlow proxy. If the feature manages agent workflows/projects, it MUST call ' +
    'GET/POST /api/primitive/agentflow/projects/ — faking it with /api/db rows or client-side state instead is a ' +
    'FAILING implementation even if the UI looks identical to the user.',
  // #524 scope check — ZeroForms below is STRENGTHENED ON SUSPICION, not
  // direct live confirmation (unlike ZeroCommerce #524, AgentFlow #525, and
  // ZeroCRM #527, all confirmed via a real production generation — ZeroCRM's
  // sweep ran a genuine full 30.3-minute generation and failed the same way).
  // ZeroForms shares the identical original-5 provenance (#443), the
  // identical plain-prose instruction shape proven insufficient four times
  // now, and the identical missing-from-RUNTIME_PROXY_PATH_SUBSTRINGS gap —
  // strengthened here on that pattern match while its own live confirmation
  // is still pending.
  ZeroForms: () =>
    `call the same-origin proxy at \`/api/primitive/zeroforms/{path}\` — NO Authorization header needed, the platform attaches the founder's real ZeroForms credential server-side; the path after \`zeroforms/\` matches ZeroForms' own REST path exactly (no /api prefix — ZeroForms' real routes are /v1/forms, not /api/v1/forms).\n` +
    '  Real call shape (copy this exactly, do not paraphrase — a default form itself is provisioned once at checkout via POST /forms, confirmed live per #421; the generated app only ever reads/writes forms + submissions through this proxy):\n' +
    '  ```js\n' +
    "  // List this company's real ZeroForms forms\n" +
    "  const res = await fetch('/api/primitive/zeroforms/forms')\n" +
    '  const forms = await res.json() // real forms, not a hardcoded form definition\n' +
    '  ```\n' +
    '  ANTI-PATTERN — FORBIDDEN: do NOT hand-roll a form builder or store submissions in /api/db instead of calling ' +
    'the real ZeroForms proxy. If the feature is building/publishing forms or collecting submissions, it MUST call ' +
    'GET/POST /api/primitive/zeroforms/forms — reimplementing it with /api/db rows instead is a FAILING implementation ' +
    'even if the UI looks identical to the user.',
  // #527/#414/#655: ZeroCRM CONFIRMED via the live sweep — a genuine full
  // 30.3-minute generation (not a network-drop artifact) failed the same way
  // as ZeroCommerce/AgentFlow. ZeroCRM was ALREADY wired into the runtime
  // proxy route (app/api/primitive/[primitive]/[...path]/route.ts's
  // PRIMITIVE_BASES + isFounderScopedPrimitive) and its real endpoint is
  // separately live-verified (GET /api/v1/deals?org_id=<real org> → 200, org
  // auto-provisioned on first call) — but it was missing from
  // RUNTIME_PROXIED_PRIMITIVES entirely, so codegen never told the model
  // ZeroCRM was directly callable AT ALL. A worse gap than ZeroCommerce's (no
  // instruction vs. a weak one), caught by the same #524 scope check.
  ZeroCRM: () =>
    `call the same-origin proxy at \`/api/primitive/zerocrm/{path}\` — NO Authorization header needed, the platform attaches the founder's real ZeroCRM credential AND the correct \`org_id\` server-side; the path after \`zerocrm/\` matches ZeroCRM's own REST path exactly.\n` +
    '  Real call shape (copy this exactly, do not paraphrase — live-verified per #414/#655: the org is auto-provisioned on first authenticated call, no separate onboarding step):\n' +
    '  ```js\n' +
    "  // List this company's real ZeroCRM contacts/deals (org_id is injected server-side — do not add it yourself)\n" +
    "  const res = await fetch('/api/primitive/zerocrm/deals')\n" +
    '  const deals = await res.json() // real ZeroCRM records, not fabricated contacts\n' +
    '  ```\n' +
    '  ANTI-PATTERN — FORBIDDEN: do NOT hand-roll a contacts/deals list using /api/db tables instead of calling the ' +
    'real ZeroCRM proxy. If the feature is a lightweight CRM/contact-management surface, it MUST call ' +
    'GET/POST /api/primitive/zerocrm/deals — persisting contacts through generic /api/db rows instead is a FAILING ' +
    'implementation even if the UI looks identical to the user.',
  // #522: ZeroVoice closes the same gap #443 fixed for the 5 primitives above
  // — a real, founder-scoped credential is captured at provisioning time
  // (#415's explicit /api/build/zerovoice action), so the runtime proxy shape
  // is identical to ZeroCommerce/ZeroPipeline/AgentFlow/ZeroForms, NOT the
  // narrower fixed-allowlist `/api/{slug}/{action}` shape the 8 below use.
  // Real endpoint paths (POST /calls/outbound, POST /sms/send) confirmed live
  // against ZeroVoice's own openapi.json — calls/SMS are the two triggers
  // this primitive is actually selected for (lib/build/primitive-catalog.ts's
  // own triggers list: 'call', 'sms', 'text', 'phone', 'dial', ...).
  ZeroVoice: () =>
    `call the same-origin proxy at \`/api/primitive/zerovoice/{path}\` (e.g. \`/api/primitive/zerovoice/calls/outbound\`, \`/api/primitive/zerovoice/sms/send\`) — NO Authorization header needed, the platform attaches the founder's real ZeroVoice credential server-side; the path after \`zerovoice/\` matches ZeroVoice's own REST path exactly.\n` +
    '  Real call shape (copy this exactly, do not paraphrase):\n' +
    '  ```js\n' +
    "  // Place an outbound call (from_number = this company's ZeroVoice number, e164 format)\n" +
    "  await fetch('/api/primitive/zerovoice/calls/outbound', {\n" +
    "    method: 'POST', headers: { 'Content-Type': 'application/json' },\n" +
    "    body: JSON.stringify({ from_number: companyE164, to_number: customerE164, record: false }),\n" +
    '  })\n' +
    '\n' +
    "  // Send an SMS\n" +
    "  await fetch('/api/primitive/zerovoice/sms/send', {\n" +
    "    method: 'POST', headers: { 'Content-Type': 'application/json' },\n" +
    "    body: JSON.stringify({ from_number: companyE164, to_number: customerE164, body: messageText }),\n" +
    '  })\n' +
    '  ```\n' +
    '  ANTI-PATTERN — FORBIDDEN: do NOT simulate "call placed" / "SMS sent" with a local status update, a fake ' +
    'toast, or a client-side mock timer instead of calling this proxy. If the feature claims to place a real call ' +
    'or send a real text, it MUST call POST /api/primitive/zerovoice/calls/outbound or POST /api/primitive/zerovoice/sms/send.',
  // #496/#499/#500/#503/#505/#510 — these 8 use a NARROWER shape than the
  // 5 above: a fixed `/api/{slug}/{action}` route with a hard allowlist of
  // real actions (not an arbitrary-path passthrough), so the model must be
  // told the EXACT allowed actions or it will hallucinate a path that 404s.
  //
  // #518: each of these 8 now also carries a literal fetch() snippet + a
  // named anti-pattern to forbid, not just prose — see this constant's doc.
  ZeroMemory: () =>
    `call the same-origin proxy — NO Authorization header needed, the platform attaches this company's own memory namespace server-side: POST /api/memory/remember { content, memory_type? } and POST /api/memory/recall { query } (both JSON body, return the real ZeroMemory response).\n` +
    '  Real call shape (copy this exactly, do not paraphrase):\n' +
    '  ```js\n' +
    "  // Store a memory (call this after the user creates/edits a record worth recalling later)\n" +
    "  await fetch('/api/memory/remember', {\n" +
    "    method: 'POST', headers: { 'Content-Type': 'application/json' },\n" +
    '    body: JSON.stringify({ content: entryText, memory_type: \'episodic\' }),\n' +
    '  })\n' +
    '\n' +
    "  // Recall relevant memories (call this to find items semantically related to new input)\n" +
    "  const res = await fetch('/api/memory/recall', {\n" +
    "    method: 'POST', headers: { 'Content-Type': 'application/json' },\n" +
    '    body: JSON.stringify({ query: newEntryText }),\n' +
    '  })\n' +
    '  const { results } = await res.json() // real ZeroMemory semantic matches, not a keyword filter you wrote\n' +
    '  ```\n' +
    '  ANTI-PATTERN — FORBIDDEN: do NOT implement "related/similar memories", "recall", or "surface past entries" as ' +
    'client-side keyword/substring/word-overlap matching over rows already loaded from /api/db (e.g. splitting text ' +
    'into words and scoring overlap). That defeats the entire purpose of ZeroMemory\'s semantic memory layer — it is ' +
    'not a text-search convenience, it is the actual feature. You MUST call POST /api/memory/remember and ' +
    'POST /api/memory/recall for any "remembers"/"recalls"/"related to past"/"similar to previous" feature; a ' +
    'hand-rolled lookalike is a FAILING implementation even if it looks similar to the user.',
  'Browser Agent': () =>
    `call the same-origin proxy — NO Authorization header needed: POST /api/browser-agent/extract { url, extract_goal } and POST /api/browser-agent/act { url, instruction } (both JSON body).\n` +
    '  Real call shape:\n' +
    '  ```js\n' +
    "  const res = await fetch('/api/browser-agent/extract', {\n" +
    "    method: 'POST', headers: { 'Content-Type': 'application/json' },\n" +
    "    body: JSON.stringify({ url: targetUrl, extract_goal: 'the specific data to pull out' }),\n" +
    '  })\n' +
    '  const data = await res.json() // real extracted data, not a guessed/mocked value\n' +
    '  ```\n' +
    '  ANTI-PATTERN — FORBIDDEN: do NOT fabricate scraped/extracted data inline (hardcoded arrays claiming to be ' +
    '"live" competitor prices, listings, or page content) instead of calling /api/browser-agent/extract or /act. ' +
    'If the feature claims to read a real external page, it MUST call this proxy.',
  Agent402: () =>
    `call the same-origin proxy — NO Authorization header needed, GET only: GET /api/agent402/capabilities and GET /api/agent402/projects (payments/payouts/Hedera actions are deliberately NOT exposed — do not attempt them).\n` +
    '  Real call shape:\n' +
    '  ```js\n' +
    "  const res = await fetch('/api/agent402/capabilities')\n" +
    '  const { capabilities } = await res.json()\n' +
    '  ```\n' +
    '  ANTI-PATTERN — FORBIDDEN: do NOT hardcode a fake "agent payment capabilities" or "x402 project" list — call ' +
    'GET /api/agent402/capabilities / GET /api/agent402/projects for the real data.',
  OpenCapStack: () =>
    `call the same-origin proxy — NO Authorization header needed: GET /api/opencapstack/company returns this company's own cap-table record (404 if none was provisioned at checkout).\n` +
    '  Real call shape:\n' +
    '  ```js\n' +
    "  const res = await fetch('/api/opencapstack/company')\n" +
    '  const capTable = res.ok ? await res.json() : null // 404 = not provisioned, handle gracefully\n' +
    '  ```\n' +
    '  ANTI-PATTERN — FORBIDDEN: do NOT hand-roll cap-table math (dilution, vesting schedules, SAFE conversion) with ' +
    'local state — call GET /api/opencapstack/company for the real, already-provisioned record.',
  'Model Catalog': () =>
    `call the same-origin proxy — NO Authorization header needed, GET only: GET /api/model-catalog/list returns the real available AINative inference models.\n` +
    '  Real call shape:\n' +
    '  ```js\n' +
    "  const res = await fetch('/api/model-catalog/list')\n" +
    '  const { models } = await res.json() // real, current model list — not a hardcoded array\n' +
    '  ```\n' +
    '  ANTI-PATTERN — FORBIDDEN: do NOT hardcode a static list of model names/prices in the component — that list ' +
    'goes stale immediately; call GET /api/model-catalog/list for the live catalog.',
  'Developer Program': () =>
    `call the same-origin proxy — NO Authorization header needed, GET only: GET /api/developer-program/analytics and GET /api/developer-program/logs (earnings/payouts are deliberately NOT exposed — do not attempt them).\n` +
    '  Real call shape:\n' +
    '  ```js\n' +
    "  const res = await fetch('/api/developer-program/analytics')\n" +
    '  const analytics = await res.json() // real usage analytics, not mocked numbers\n' +
    '  ```\n' +
    '  ANTI-PATTERN — FORBIDDEN: do NOT invent placeholder analytics/usage numbers — call ' +
    'GET /api/developer-program/analytics and /logs for the real data.',
  Community: () =>
    `call the same-origin proxy — NO Authorization header needed, GET only: GET /api/community/members returns the real AINative community member list.\n` +
    '  Real call shape:\n' +
    '  ```js\n' +
    "  const res = await fetch('/api/community/members')\n" +
    '  const { members } = await res.json() // real member list, not fabricated profiles\n' +
    '  ```\n' +
    '  ANTI-PATTERN — FORBIDDEN: do NOT fabricate a fake member/user list — call GET /api/community/members.',
  AINativeNGO: () =>
    `call the same-origin proxy — NO Authorization header needed, GET only: GET /api/ainative-ngo/institutions returns real nonprofit/NGO institution records.\n` +
    '  Real call shape:\n' +
    '  ```js\n' +
    "  const res = await fetch('/api/ainative-ngo/institutions')\n" +
    '  const { institutions } = await res.json() // real institution records, not sample data\n' +
    '  ```\n' +
    '  ANTI-PATTERN — FORBIDDEN: do NOT hardcode sample nonprofit/institution records — call ' +
    'GET /api/ainative-ngo/institutions for the real data.',
}

/**
 * Names of catalog primitives whose selection implies a specific, greppable
 * real-proxy path substring that MUST appear somewhere in the generated code
 * if that primitive was actually wired (used by the #518 post-generation
 * compliance check below). Kept separate from RUNTIME_PROXIED_PRIMITIVES'S
 * prompt strings (which are prose+code for the MODEL) so the validator has a
 * small, precise, regex-friendly fact instead of parsing prompt text.
 */
export const RUNTIME_PROXY_PATH_SUBSTRINGS: Record<string, string[]> = {
  // #524/#525/#527: was missing entirely for all 5 original founder-scoped
  // primitives, so the #518 post-generation compliance validator had no way
  // to catch an unwired selection of any of them. Now it does.
  ZeroCommerce: ['/api/primitive/zerocommerce/commerce/products', '/api/primitive/zerocommerce/commerce/checkout'],
  ZeroPipeline: ['/api/primitive/zeropipeline/deals'],
  AgentFlow: ['/api/primitive/agentflow/projects/'],
  ZeroForms: ['/api/primitive/zeroforms/forms'],
  ZeroCRM: ['/api/primitive/zerocrm/deals'],
  ZeroVoice: ['/api/primitive/zerovoice/calls/outbound', '/api/primitive/zerovoice/sms/send'],
  ZeroMemory: ['/api/memory/remember', '/api/memory/recall'],
  'Browser Agent': ['/api/browser-agent/extract', '/api/browser-agent/act'],
  Agent402: ['/api/agent402/capabilities', '/api/agent402/projects'],
  OpenCapStack: ['/api/opencapstack/company'],
  'Model Catalog': ['/api/model-catalog/list'],
  'Developer Program': ['/api/developer-program/analytics', '/api/developer-program/logs'],
  Community: ['/api/community/members'],
  AINativeNGO: ['/api/ainative-ngo/institutions'],
}

/** Names of primitives covered by the #518 post-generation compliance check. */
export function getComplianceCheckedPrimitiveNames(): string[] {
  return Object.keys(RUNTIME_PROXY_PATH_SUBSTRINGS)
}

/**
 * The exact "To use" instruction (code snippet + anti-pattern language) for a
 * RUNTIME_PROXIED_PRIMITIVES primitive, keyed by name. Exposed so the #518
 * post-generation repair prompt (lib/build/obedience-gate.ts) can quote the
 * SAME instruction the model already got in the composition block instead of
 * duplicating it — a repair pass that repeats the identical, specific
 * anti-pattern warning is more likely to land than a generic "please fix"
 * re-prompt. Returns undefined for a primitive not in the map.
 */
export function getRuntimeProxyInstruction(name: string): string | undefined {
  const build = RUNTIME_PROXIED_PRIMITIVES[name]
  return build ? build(getPrimitive(name)?.apiBase || '') : undefined
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
 * endpoint/SDK. Only `RUNTIME_PROXIED_PRIMITIVES` get a literal fetch()
 * instruction (they have a real same-origin proxy the generated app can call);
 * everything else is framed honestly as "already provisioned server-side, the
 * app doesn't call it directly" — see that constant's doc for why.
 */
export function codegenCompositionBlock(idea: string, track: 'app' | 'company' = 'company', role?: CompanyRole): string {
  const { foundational, selected } = selectPrimitives(idea, track, 6, role)
  // Wire foundational substrate first, then the idea-matched business-ops layer.
  const wireable = [...foundational, ...selected].filter((p) => p.apiBase || p.sdk)
  // De-dup by name (foundational + selected can't overlap, but be safe).
  const seen = new Set<string>()
  const lines: string[] = []
  for (const p of wireable) {
    if (seen.has(p.name)) continue
    seen.add(p.name)
    const how = !p.apiBase
      ? `import its SDK \`${p.sdk}\``
      : RUNTIME_PROXIED_PRIMITIVES[p.name]
        ? RUNTIME_PROXIED_PRIMITIVES[p.name](p.apiBase)
        : `it was already provisioned for this company server-side at setup time — the generated app does NOT call \`${p.apiBase}\` directly (no key ships to the browser); build the UI/logic assuming that data/action already exists, and persist any app-side records it produces through the ZeroDB proxy below`
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
    `This app must be BUILT ON AINative's real products, not a from-scratch clone. When a primitive below covers a capability the app needs (invoicing, CRM/sales, ecommerce/checkout, telephony/SMS, cap-table/equity, helpdesk, content/social, streaming, marketplace), design around that primitive instead of hand-rolling the logic — follow the "To use" instruction for each one exactly, since some are called directly and some are already provisioned server-side (see below):\n\n` +
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
    `  For a real login screen, render an email+continue form that sets that uid — do NOT call an external auth API.\n` +
    `- VISITOR TRACKING (#483/#563 real gap fix — the founder's Live dashboard shows a real "visitors" count that\n` +
    `  was previously a permanent, hardcoded 0 with nothing behind it): the top-level landing/home page component\n` +
    `  MUST fire exactly ONE pageview on mount via the same /api/db proxy — a plain, honest event row, never a\n` +
    `  fake counter:\n` +
    `    useEffect(() => { fetch('/api/db/visitors', { method: 'POST', headers: {'Content-Type':'application/json'},\n` +
    `      body: JSON.stringify({ path: window.location.pathname, ts: new Date().toISOString() }) }).catch(() => {}) }, [])\n` +
    `  Fire this ONCE per mount of the landing/home route only (not on every route, not on every re-render) —\n` +
    `  best-effort, a failed beacon must never block or error the page.\n\n` +
    `Rules:\n` +
    `1. Import \`@ainative/ai-kit-core\` (and its React bindings) for UI primitives — do NOT rebuild chat, tables, product cards, or dashboards from scratch when an AI Kit component exists.\n` +
    `2. Persist through /api/db (above) — this is MANDATORY when the app saves any records. The generated app runs in the browser, so it does NOT have AINATIVE_API_KEY; NEVER put a Bearer key or secret in app code, and NEVER fetch() a primitive's apiBase directly unless this block explicitly said to. Each primitive above tells you EXACTLY how to call it under "To use:" — follow that literally (same-origin proxy path and method, no Authorization header for proxied primitives, a Bearer key only for ZeroDB/Instant DB via /api/db). For any primitive listed above framed as "already provisioned for this company server-side," treat its capability as already set up by the platform — build the UI around it, don't call its API from generated code.\n` +
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

/**
 * PLANNING/ARTIFACT primitive-grounding block (#519).
 *
 * codegenCompositionBlock() (above) tells the CODE-GENERATION model which real
 * AINative primitives to wire up. But the company-track PLANNING artifacts
 * (thesis, businessModel, plan30, …) are prose written by a completely
 * separate LLM call (app/api/build/artifact/route.ts via ARTIFACT_PROMPTS in
 * artifact-prompts.ts) that never received any equivalent instruction — so
 * when a plan discusses technical implementation, the model falls back to
 * generic industry knowledge (OpenAI embeddings, Firebase, Stripe, …) instead
 * of the platform's OWN already-selected primitives. A real production run
 * for a journaling app whose composition table correctly cited ZeroMemory +
 * ZeroDB produced a 30-Day Plan that instead said "OpenAI embeddings API" and
 * "Firebase" — same idea, same session, two inconsistent stories.
 *
 * This is the prose-appropriate sibling of codegenCompositionBlock(): same
 * selectPrimitives() call (so the planning artifacts and the composition
 * table always agree on what was selected), but phrased as an instruction to
 * a business-writing model, not a coding one — cite these primitives BY NAME
 * when the plan touches implementation, and do not invent third-party tools
 * for capabilities the platform already provides.
 */
export function primitiveGroundingBlock(idea: string, track: 'app' | 'company' = 'company', role?: CompanyRole): string {
  const { foundational, selected } = selectPrimitives(idea, track, 6, role)
  const seen = new Set<string>()
  const lines: string[] = []
  for (const p of [...foundational, ...selected]) {
    if (seen.has(p.name)) continue
    seen.add(p.name)
    lines.push(`- ${p.name} — ${p.purpose}`)
  }
  return (
    `\n\nREAL AINATIVE PRIMITIVES ALREADY SELECTED FOR THIS IDEA (do not invent alternatives):\n` +
    lines.join('\n') + '\n' +
    `When this plan/artifact discusses technical implementation (data storage, memory/recall, search, payments, ` +
    `CRM, messaging, auth, or any other capability one of the primitives above already provides), cite THESE real, ` +
    `already-selected AINative primitives by name instead of generic third-party tools. Do NOT invent or suggest ` +
    `third-party tools (e.g. OpenAI's embeddings API, Firebase, Stripe, Twilio, Auth0) for capabilities these ` +
    `primitives already provide — this idea's own composition table already committed to the list above, so this ` +
    `artifact must stay consistent with it.`
  )
}
