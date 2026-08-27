/**
 * Pay-gate proposal logic (#68) — the concrete, designed proposal shown at the
 * Launch/pay gate. The #1 conversion lever from customer feedback: the founder
 * pays when they SEE what Cody will build ("this is what I'm planning"), what it
 * costs, AND can click each proposed business system to preview it in context
 * ("here's what it'd look like if you had ZeroInvoice").
 *
 * Pure module — no React, no imports with side effects, no I/O. Fully unit
 * testable. The ProposalGate component renders whatever this returns; all the
 * "what gets built + what it does + what it'd look like + what it costs" wiring
 * lives here so it's deterministic and covered.
 */

import { buildSystems, type BusinessSystem } from '@/lib/build/business-systems'
import { getPrimitive } from '@/lib/build/primitive-catalog'

/** A single proposed business system, enriched for the pay-gate proposal. */
export interface ProposedSystem {
  /** Stable key (from BusinessSystem.key) — used as React key + preview id. */
  key: string
  /** Display name / primitive name (e.g. "ZeroInvoice"). */
  name: string
  /** Canonical AINative primitive backing it. */
  primitive: string
  /** One-line "what it does" — the founder's plain-language why. */
  whatItDoes: string
  /** Zero-state stat line ("Ready · $0 collected") for honest framing. */
  stat: string
  /** Docs link (secondary affordance). */
  docUrl: string
  /**
   * Provisioning honesty (#67): true when this system already reads real
   * per-company data. At the pay gate almost everything is `false` (planned) —
   * that's the point: this is what you'll GET.
   */
  provisioned: boolean
}

/**
 * A representative in-context preview of a system ("here's what it'd look like
 * if you had ZeroInvoice"). Deliberately concrete: a title, a sub-line, and a
 * few example rows the founder can picture in their own company. Not fabricated
 * live data — it's a labeled representative mock (see `note`).
 */
export interface SystemPreview {
  key: string
  name: string
  primitive: string
  /** The headline for the preview panel. */
  title: string
  /** One-line description of the view being previewed. */
  subtitle: string
  /**
   * Column headers for the representative table (2–3 columns).
   */
  columns: string[]
  /**
   * A few representative rows — arrays aligned to `columns`. These are examples
   * so the founder can imagine their own company here, not live data.
   */
  rows: string[][]
  /** Honest label so the preview is never mistaken for live data. */
  note: string
}

/** The full designed proposal surfaced at the pay gate. */
export interface Proposal {
  companyName: string
  /** The founder's original idea (drives which systems Cody proposes). */
  idea: string
  /** The systems Cody will wire, idea-driven + enriched. */
  systems: ProposedSystem[]
  /** Mid-journey framing headline — "you've already started". */
  headline: string
  /** Supporting sub-line under the headline. */
  subline: string
  /** The plain-language line for the recommended plan + price. */
  costLine: string
  /** Recommended tier id to spotlight (e.g. 'pro'). */
  recommendedTier: string
}

/** Recommended plan for the proposal cost line. */
export interface ProposalPlan {
  id: string
  name: string
  monthly: number
}

/**
 * Per-primitive "what it'd look like" preview template. Keyed by canonical
 * primitive name. Falls back to a generic template for anything not listed so a
 * newly-added primitive still previews (never a blank panel).
 */
const PREVIEW_TEMPLATES: Record<
  string,
  { title: string; subtitle: string; columns: string[]; rows: string[][] }
> = {
  ZeroPipeline: {
    title: 'Sales pipeline',
    subtitle: 'Every deal Cody sources and moves toward close.',
    columns: ['Deal', 'Stage', 'Value'],
    rows: [
      ['Acme Corp — annual', 'Proposal', '$24,000'],
      ['Northwind pilot', 'Discovery', '$8,500'],
      ['Globex renewal', 'Negotiation', '$41,000'],
    ],
  },
  ZeroInvoice: {
    title: 'Invoices & billing',
    subtitle: 'Send invoices, take Stripe payments, chase what’s owed.',
    columns: ['Invoice', 'Customer', 'Status'],
    rows: [
      ['INV-1042', 'Acme Corp', 'Paid'],
      ['INV-1043', 'Northwind', 'Sent'],
      ['INV-1044', 'Globex', 'Overdue'],
    ],
  },
  ZeroCommerce: {
    title: 'Storefront & orders',
    subtitle: 'A live catalog with semantic search and Stripe checkout.',
    columns: ['Order', 'Items', 'Total'],
    rows: [
      ['#1001', 'House Blend ×2', '$36'],
      ['#1002', 'Cold Brew Kit', '$54'],
      ['#1003', 'Gift Set', '$72'],
    ],
  },
  ServiceOS: {
    title: 'Helpdesk',
    subtitle: 'Tickets, queues, and agent workflows for support.',
    columns: ['Ticket', 'Subject', 'Status'],
    rows: [
      ['#204', 'Login issue', 'Open'],
      ['#205', 'Refund request', 'In progress'],
      ['#206', 'Feature question', 'Resolved'],
    ],
  },
  ZeroVoice: {
    title: 'Calls & SMS',
    subtitle: 'Programmable phone: calls, texts, IVR, recordings.',
    columns: ['Contact', 'Type', 'Outcome'],
    rows: [
      ['+1 (415) 555-0132', 'Outbound call', 'Booked'],
      ['+1 (212) 555-0148', 'SMS reminder', 'Delivered'],
      ['+1 (628) 555-0199', 'Inbound call', 'Voicemail'],
    ],
  },
  OpenCapStack: {
    title: 'Cap table',
    subtitle: 'Stakeholders, SAFEs, grants, vesting, and waterfall.',
    columns: ['Stakeholder', 'Instrument', 'Ownership'],
    rows: [
      ['Founder', 'Common', '68%'],
      ['Angel round', 'SAFE', '12%'],
      ['Option pool', 'Reserved', '10%'],
    ],
  },
  'Content Workflow': {
    title: 'Content & distribution',
    subtitle: 'AI personas, scheduled posts, auto-captions, auto-publish.',
    columns: ['Post', 'Channel', 'Status'],
    rows: [
      ['Launch announcement', 'LinkedIn', 'Scheduled'],
      ['Weekly digest', 'Newsletter', 'Draft'],
      ['Product teaser', 'X', 'Published'],
    ],
  },
  'Live Streaming': {
    title: 'Live streaming',
    subtitle: 'RTMPS in / HLS out, real-time chat, VOD, analytics.',
    columns: ['Stream', 'Status', 'Viewers'],
    rows: [
      ['Launch event', 'Scheduled', '—'],
      ['Weekly AMA', 'Live', '128'],
      ['Recorded demo', 'VOD', '1,204'],
    ],
  },
  'Intent-Casting Marketplace': {
    title: 'Marketplace',
    subtitle: 'Buyers broadcast intents; sellers respond with services.',
    columns: ['Listing', 'Type', 'Matches'],
    rows: [
      ['Design sprint', 'Service', '4'],
      ['Bulk supply', 'Request', '7'],
      ['Consulting hour', 'Service', '2'],
    ],
  },
  'Browser Agent': {
    title: 'Browser automation',
    subtitle: 'Web data extraction + browser automation jobs.',
    columns: ['Job', 'Target', 'Status'],
    rows: [
      ['Price monitor', 'competitor.com', 'Running'],
      ['Lead scrape', 'directory.io', 'Queued'],
      ['Form fill', 'portal.gov', 'Done'],
    ],
  },
}

/**
 * Enrich the idea-driven systems list into proposed systems with plain-language
 * "what it does" copy pulled from the machine-readable primitive catalog.
 *
 * @param systems  Output of buildSystems(idea) — already idea-driven.
 */
export function toProposedSystems(systems: BusinessSystem[]): ProposedSystem[] {
  return systems.map((s) => {
    const prim = getPrimitive(s.primitive)
    return {
      key: s.key,
      name: s.name,
      primitive: s.primitive,
      whatItDoes: prim?.purpose ?? 'A business system Cody wires for your company.',
      stat: s.stat,
      docUrl: s.docUrl,
      provisioned: Boolean(s.provisioned),
    }
  })
}

/**
 * Build the representative in-context preview for one proposed system ("here's
 * what it'd look like if you had ZeroInvoice"). Never returns null — an unknown
 * primitive gets a generic-but-concrete preview so the panel is never empty.
 */
export function systemPreview(system: ProposedSystem): SystemPreview {
  const tpl = PREVIEW_TEMPLATES[system.primitive]
  if (tpl) {
    return {
      key: system.key,
      name: system.name,
      primitive: system.primitive,
      title: tpl.title,
      subtitle: tpl.subtitle,
      columns: tpl.columns,
      rows: tpl.rows,
      note: `Representative preview — this is what ${system.name} looks like once it’s wired with your real data.`,
    }
  }
  // Generic fallback: still concrete, still on-brand, never blank.
  return {
    key: system.key,
    name: system.name,
    primitive: system.primitive,
    title: system.name,
    subtitle: system.whatItDoes,
    columns: ['Item', 'Detail', 'Status'],
    rows: [
      ['Example record', system.name, 'Ready'],
      ['Example record', system.name, 'Ready'],
    ],
    note: `Representative preview — this is what ${system.name} looks like once it’s wired with your real data.`,
  }
}

/**
 * Compose the full pay-gate proposal from the founder's context.
 *
 * @param opts.companyName  The company name ("" → generic copy).
 * @param opts.idea         The founder's idea (drives system selection).
 * @param opts.plan         The recommended tier (name + price) for the cost line.
 * @param opts.maxSystems   Cap on proposed systems (default 4).
 * @param opts.sawPreview   Has the founder actually SEEN their working preview
 *                          (#310/#311)? "You've seen it work" is only claimable
 *                          when true. Defaults true (the normal post-preview
 *                          pay-gate path).
 */
export function buildProposal(opts: {
  companyName?: string
  idea?: string
  plan: ProposalPlan
  maxSystems?: number
  sawPreview?: boolean
}): Proposal {
  const companyName = (opts.companyName || '').trim()
  const idea = (opts.idea || '').trim()
  const displayName = companyName || 'your company'
  const maxSystems = opts.maxSystems ?? 4

  const systems = toProposedSystems(buildSystems(idea, {}, {}, maxSystems))
  const sawPreview = opts.sawPreview ?? true

  const n = systems.length
  // Honest framing (#310/#311): claim "you've seen it work" only when the
  // founder actually has. Before the value moment, present it as the plan.
  const headline = sawPreview
    ? (companyName
        ? `You’ve seen ${companyName} work. Here’s what Cody builds next.`
        : 'You’ve seen it work. Here’s what Cody builds next.')
    : (companyName
        ? `Here’s what Cody is building for ${companyName}.`
        : 'Here’s what Cody is building.')

  const running = sawPreview ? 'your app is running' : 'your app is on the way'
  const subline = n > 0
    ? `You’re already down the path — ${running}. To make ${displayName} real, Cody wires ${n} business system${n === 1 ? '' : 's'} around it. Click any one to see what it’d look like.`
    : `You’re already down the path — ${running}. Cody wires the business systems that make ${displayName} real.`

  const costLine = `Everything below is included on ${opts.plan.name} — $${opts.plan.monthly}/mo. You own 100%, cancel anytime.`

  return {
    companyName,
    idea,
    systems,
    headline,
    subline,
    costLine,
    recommendedTier: opts.plan.id,
  }
}

/**
 * Count planned vs live systems in a proposal (at the pay gate these are almost
 * all "planned" — that's the value proposition). Mirrors the shape used by the
 * live-vs-planned framing so the ProposalGate can reuse `planFramingLine`.
 */
export function proposalStatusCounts(
  systems: ProposedSystem[],
): { live: number; planned: number; total: number } {
  let live = 0
  let planned = 0
  for (const s of systems) {
    if (s.provisioned) live++
    else planned++
  }
  return { live, planned, total: systems.length }
}
