/**
 * Business-systems model for the Live dashboard (#233, #288, #278).
 *
 * Each business system on the Live dashboard maps to a real AINative primitive.
 * Systems are now IDEA-DRIVEN — a coffee brand gets ZeroCommerce, a fundraising
 * company gets OpenCapStack, rather than every build showing the same 4 systems.
 *
 * Card links (#278): never point to primitive marketing sites. When the company
 * has a real provisioned instance the card links there; otherwise it is a
 * non-navigating status card (no href dump onto a marketing domain).
 */

import { scorePrimitives, CATALOG, type CatalogPrimitive } from '@/lib/build/primitive-catalog'

export interface BusinessSystem {
  /** Stable key for this system (slug of primitive name) */
  key: string
  name: string
  primitive: string
  /**
   * Link target for the card (#278).
   * - If the company has a provisioned instance: URL to that instance.
   * - Otherwise: undefined — card renders as a non-navigating status panel.
   * We NEVER fall back to the primitive's marketing site.
   */
  url?: string
  /** Doc URL — "learn more" only, not the primary card action */
  docUrl: string
  /** Live stat line (zero-state for a new company; filled from real data when present) */
  stat: string
  /** Numeric counters — real per-company values (0 for a fresh company) */
  count: number
  value?: number
  /**
   * True when this system's counts come from the company's REAL provisioned
   * ZeroDB project (#243). False = still simulated / no per-company data source
   * wired yet, so the UI can mark it honestly instead of implying live data.
   */
  provisioned?: boolean
  /**
   * Savings comparison (#dashboard-ux): what the founder would pay for a
   * comparable stand-alone SaaS to replace this AINative primitive. Included so
   * the card can communicate "you'd pay $X/mo for <provider>, included here."
   * Undefined when we don't have a credible comparable to quote (never invent one).
   */
  vsProvider?: string
  /** Entry monthly price (USD) of that comparable provider, for the savings line. */
  savedMonthly?: number
}

/**
 * Comparable stand-alone SaaS per primitive (#dashboard-ux). Each entry is the
 * provider a founder would otherwise sign up + pay for, and that provider's
 * credible ENTRY monthly price (USD). With Builder, every AINative primitive is
 * included on usage-based billing, so these are the per-system costs the founder
 * AVOIDS. Prices are entry-tier list prices (kept conservative/defensible); update
 * as providers change. Only primitives with a credible comparable are listed —
 * anything absent renders without a savings line rather than a made-up number.
 */
export const SAVINGS_BY_PRIMITIVE: Record<string, { vsProvider: string; monthly: number }> = {
  // CRM / sales pipeline → Salesforce Sales Cloud (Pro), per-seat entry.
  ZeroPipeline: { vsProvider: 'Salesforce', monthly: 25 },
  // Invoicing / billing → QuickBooks / Stripe Billing entry.
  ZeroInvoice: { vsProvider: 'QuickBooks', monthly: 30 },
  // Storefront / commerce → Shopify Basic.
  ZeroCommerce: { vsProvider: 'Shopify', monthly: 29 },
  // Helpdesk / support → Zendesk Suite (per-agent entry).
  ServiceOS: { vsProvider: 'Zendesk', monthly: 55 },
  // Voice / telephony → Twilio Voice baseline.
  ZeroVoice: { vsProvider: 'Twilio', monthly: 15 },
  // Cap table → Carta (entry).
  OpenCapStack: { vsProvider: 'Carta', monthly: 40 },
  // Knowledge graph → Neo4j AuraDB (entry managed instance).
  'Context Graph': { vsProvider: 'Neo4j AuraDB', monthly: 65 },
  // Social graph / relationships → also a managed graph DB (Neo4j-class).
  'Social Graph': { vsProvider: 'Neo4j AuraDB', monthly: 65 },
  // Community / groups / feeds → a community platform (Circle entry).
  Community: { vsProvider: 'Circle', monthly: 49 },
  // Unified + semantic search → Algolia (entry) / a hosted vector DB.
  'Search & Discovery': { vsProvider: 'Algolia', monthly: 50 },
  // App database / backend → Supabase Pro.
  ZeroDB: { vsProvider: 'Supabase', monthly: 25 },
}

/** Per-primitive stat config (used to build the stat line and counts). */
interface PrimitiveStat {
  /** How many items does this primitive track? (pulled from counts map) */
  countKey?: string
  /** What does a single "item" represent (for the stat label)? */
  unit: string
  /** Format a non-zero count + value into a stat string */
  statFn: (count: number, value: number) => string
  /** Stat string when count is zero */
  zeroStat: string
}

const PRIM_STATS: Record<string, PrimitiveStat> = {
  ZeroPipeline: {
    countKey: 'pipeline',
    unit: 'deals',
    statFn: (n, v) => `${n} open · $${(v / 1000).toFixed(0)}k`,
    zeroStat: 'Ready · Scout sourcing',
  },
  ZeroInvoice: {
    countKey: 'invoices',
    unit: 'invoices',
    statFn: (_, v) => `$${(v / 1000).toFixed(1)}k collected`,
    zeroStat: 'Ready · $0 collected',
  },
  ZeroCommerce: {
    countKey: 'orders',
    unit: 'orders',
    statFn: (n, v) => `${n} orders · $${(v / 1000).toFixed(1)}k`,
    zeroStat: 'Ready · shop live',
  },
  ServiceOS: {
    countKey: 'tickets',
    unit: 'tickets',
    statFn: (n) => `${n} open tickets`,
    zeroStat: 'Ready · 0 tickets',
  },
  ZeroVoice: {
    countKey: 'calls',
    unit: 'calls',
    statFn: (n) => `${n} calls`,
    zeroStat: 'Ready · 0 calls',
  },
  OpenCapStack: {
    countKey: 'stakeholders',
    unit: 'stakeholders',
    statFn: (n) => `${n} stakeholders`,
    zeroStat: 'Ready · cap table empty',
  },
  'Content Workflow': {
    countKey: 'posts',
    unit: 'posts',
    statFn: (n) => `${n} posts published`,
    zeroStat: 'Ready · drafting content',
  },
  'Live Streaming': {
    countKey: 'streams',
    unit: 'streams',
    statFn: (n) => `${n} streams`,
    zeroStat: 'Ready · 0 streams',
  },
  'Intent-Casting Marketplace': {
    countKey: 'listings',
    unit: 'listings',
    statFn: (n) => `${n} listings`,
    zeroStat: 'Ready · marketplace live',
  },
  'Browser Agent': {
    countKey: 'jobs',
    unit: 'jobs',
    statFn: (n) => `${n} jobs run`,
    zeroStat: 'Ready · monitoring',
  },
  // Social / community + data primitives can now surface for non-business-ops
  // ideas (a social app should show these, not ZeroInvoice). (#72)
  'Social Graph': {
    countKey: 'connections',
    unit: 'connections',
    statFn: (n) => `${n} connections`,
    zeroStat: 'Ready · 0 connections',
  },
  Community: {
    countKey: 'members',
    unit: 'members',
    statFn: (n) => `${n} members`,
    zeroStat: 'Ready · 0 members',
  },
  'Context Graph': {
    countKey: 'entities',
    unit: 'entities',
    statFn: (n) => `${n} entities`,
    zeroStat: 'Ready · graph empty',
  },
  'Search & Discovery': {
    countKey: 'documents',
    unit: 'indexed',
    statFn: (n) => `${n} indexed`,
    zeroStat: 'Ready · index empty',
  },
  ZeroDB: {
    countKey: 'posts',
    unit: 'records',
    statFn: (n) => `${n} records`,
    zeroStat: 'Ready · 0 records',
  },
}

/**
 * The "run a company" business-ops primitives. Used ONLY as last-resort defaults
 * when an idea matches too few real primitives to fill the grid (#72). A social
 * app must NOT be defaulted into ZeroInvoice/ZeroCommerce, so these are appended
 * behind the idea-matched set, never ahead of it.
 */
const BUSINESS_OP_NAMES = new Set([
  'ZeroPipeline', 'ZeroInvoice', 'ZeroCommerce', 'ZeroVoice',
  'OpenCapStack', 'ServiceOS', 'Content Workflow', 'Live Streaming',
  'Intent-Casting Marketplace', 'Browser Agent',
])

/**
 * Every primitive eligible to render as a system card. Superset of business-ops
 * plus the social/community + data primitives a non-business-ops idea needs
 * (Social Graph, Community, Context Graph, Search & Discovery, ZeroDB). (#72)
 *
 * Foundational substrate that isn't itself a "system" the founder reasons about
 * (Instant DB, ZeroMemory, AI Kit, Agent Cloud) is intentionally excluded so the
 * grid shows product-shaped systems, not plumbing.
 */
const SYSTEM_CARD_NAMES = new Set<string>([
  ...BUSINESS_OP_NAMES,
  'Social Graph', 'Community', 'Context Graph', 'Search & Discovery', 'ZeroDB',
])

/**
 * Build the systems list for a company from its idea + real counts.
 *
 * The list is IDEA-DRIVEN: primitives are ranked by idea relevance
 * (`scorePrimitives`) and the top matches that can render as a system card are
 * surfaced — business-ops OR social/community/data (#72). A social app shows
 * Social Graph / Community / Context Graph / Search & Discovery, a coffee brand
 * shows ZeroCommerce, a fundraising company shows OpenCapStack. Business-ops
 * defaults only backfill the grid when the idea matched too few real primitives —
 * they never displace a strong idea match. Missing/zero counts render the honest
 * zero-state. `counts` comes from the company's real primitive data
 * (via /api/build/systems); defaults to all-zero.
 *
 * @param idea      The founder's original idea string (drives primitive selection)
 * @param counts    Real per-primitive counts from the company's ZeroDB project
 * @param opts      Provisioning state flags
 * @param maxCards  Max number of system cards to show (default 4)
 */
export function buildSystems(
  idea: string = '',
  counts: Record<string, { count?: number; value?: number }> = {},
  opts: { provisioned?: boolean; pipelineProvisioned?: boolean; instanceUrls?: Record<string, string> } = {},
  maxCards = 4,
): BusinessSystem[] {
  // (#72) Rank ALL primitives (foundational included) by idea relevance, then
  // keep the ones that (a) render as a system card and (b) actually matched the
  // idea. This lets a social app surface Social Graph / Community / Context Graph
  // / Search & Discovery, and a note-taking app surface ZeroDB (a matched
  // foundational primitive) — instead of a forced business-ops set. Foundational
  // primitives only qualify when they genuinely matched (matched.length > 0), so
  // ZeroDB shows for "posts/feed" ideas but not for every build.
  const ranked = scorePrimitives(idea, 'company')
  let candidates = ranked
    .filter((s) => s.matched.length > 0 && SYSTEM_CARD_NAMES.has(s.primitive.name))
    .map((s) => s.primitive)

  // Only if the idea genuinely didn't match enough real primitives to fill the
  // grid do we top up with business-ops defaults (ZeroPipeline/ZeroInvoice etc.).
  // These are appended BEHIND the idea-matched set, so a strong social/data match
  // is never displaced by a generic default.
  if (candidates.length < maxCards) {
    const defaults = CATALOG.filter(
      (p) => BUSINESS_OP_NAMES.has(p.name) && !candidates.find((c) => c.name === p.name),
    )
    candidates = [...candidates, ...defaults]
  }

  candidates = candidates.slice(0, maxCards)

  const zdb = Boolean(opts.provisioned)
  const pipelineLive = Boolean(opts.pipelineProvisioned) || zdb
  const instanceUrls = opts.instanceUrls || {}

  return candidates.map((prim): BusinessSystem => {
    const stat = PRIM_STATS[prim.name]
    const countKey = stat?.countKey ?? prim.name.toLowerCase()
    const rawCount = counts[countKey]?.count ?? 0
    const rawValue = counts[countKey]?.value ?? 0

    // Per-primitive provisioning honesty (#243)
    let isProvisioned = false
    if (prim.name === 'ZeroPipeline') isProvisioned = pipelineLive
    else if (['ZeroInvoice', 'ZeroCommerce', 'OpenCapStack'].includes(prim.name)) isProvisioned = zdb
    // ServiceOS, ZeroVoice, Content Workflow etc. have no per-company data yet

    // Card URL (#278): own instance > no URL. Never marketing site.
    const url = instanceUrls[prim.name] || undefined

    const statStr = rawCount > 0
      ? (stat?.statFn(rawCount, rawValue) ?? `${rawCount} ${stat?.unit ?? 'items'}`)
      : (stat?.zeroStat ?? 'Ready')

    const saving = SAVINGS_BY_PRIMITIVE[prim.name]

    return {
      key: prim.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      name: prim.name,
      primitive: prim.name,
      url,
      docUrl: prim.url,
      stat: statStr,
      count: rawCount,
      value: rawValue > 0 ? rawValue : undefined,
      provisioned: isProvisioned,
      vsProvider: saving?.vsProvider,
      savedMonthly: saving?.monthly,
    }
  })
}

/**
 * Legacy compat: build systems with the old 4-system fixed set for callers that
 * haven't migrated to passing an idea yet. Used nowhere new — bridges old call
 * sites that pass a counts Record with pipeline/invoices/helpdesk/voice keys.
 *
 * @deprecated Pass `idea` to `buildSystems` instead.
 */
export function buildSystemsLegacy(
  counts: Partial<Record<'pipeline' | 'invoices' | 'helpdesk' | 'voice', { count?: number; value?: number }>> = {},
  opts: { provisioned?: boolean; pipelineProvisioned?: boolean } = {},
): BusinessSystem[] {
  // Map old fixed keys → new generic counts shape
  const mapped: Record<string, { count?: number; value?: number }> = {}
  if (counts.pipeline) mapped.pipeline = counts.pipeline
  if (counts.invoices) mapped.invoices = counts.invoices
  if (counts.helpdesk) mapped.tickets = counts.helpdesk
  if (counts.voice) mapped.calls = counts.voice
  return buildSystems('pipeline invoices helpdesk voice', mapped, opts)
}
