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

import { selectPrimitives, CATALOG, type CatalogPrimitive } from '@/lib/build/primitive-catalog'

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
}

/** The subset of catalog primitives eligible to appear as business-system cards. */
const BUSINESS_OP_NAMES = new Set([
  'ZeroPipeline', 'ZeroInvoice', 'ZeroCommerce', 'ZeroVoice',
  'OpenCapStack', 'ServiceOS', 'Content Workflow', 'Live Streaming',
  'Intent-Casting Marketplace', 'Browser Agent',
])

/**
 * Build the systems list for a company from its idea + real counts.
 *
 * The list is IDEA-DRIVEN: `selectPrimitives(idea, 'company')` picks the most
 * relevant business-ops primitives for this specific company. Missing/zero counts
 * render the honest zero-state. `counts` comes from the company's real primitive
 * data (via /api/build/systems); defaults to all-zero.
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
  const { selected, foundational } = selectPrimitives(idea, 'company', 8)

  // Filter to business-op primitives from the idea-selected set
  let candidates = selected.filter((p) => BUSINESS_OP_NAMES.has(p.name))

  // If the idea doesn't match enough business-op primitives, fill from the
  // catalog's business-ops layer ordered by category score — prefer ZeroPipeline
  // and ZeroInvoice as generally-useful defaults.
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
