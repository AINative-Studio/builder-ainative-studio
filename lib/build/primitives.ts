/**
 * Primitive-context map (#218/#220) — the single data source driving both the
 * "Powering this" chip strip and Cody's contextual nudges. From
 * 06-IMPLEMENTATION-NOTES.md, reconciled against docs/AINATIVE_PRIMITIVES.md so
 * the surfaced names match real AINative primitives.
 */

export interface PrimitiveNudge {
  prim: string   // primitive to weave in
  to?: string    // artifact view to route to on accept
  text: string   // Cody's first-person pitch
  cta: string    // accept-button label
}

export interface PrimitiveEntry {
  powered: string[]
  nudge?: PrimitiveNudge | null
}

/** Every primitive name here exists in docs/AINATIVE_PRIMITIVES.md. */
export const PRIMITIVE_MAP: Record<string, PrimitiveEntry> = {
  // ---- App Track ----
  brief: {
    powered: ['ZeroMemory', 'GraphRAG'],
    nudge: { prim: 'AI Kit Safety', text: "This is customer-facing — I'll add prompt-injection and PII guards so it stays safe in the wild.", cta: 'Add Safety' },
  },
  prd: { powered: ['Sequential Thinking', 'ZeroMemory'], nudge: null },
  comp: { powered: ['ZeroDB', 'ZeroMemory', 'Agent Cloud', 'MCP', 'AI Kit', 'AI Kit Safety'], nudge: null },
  dataModel: {
    powered: ['ZeroDB · Vectors', 'Managed embeddings'],
    nudge: { prim: 'ZeroDB Functions', text: "I can auto-embed new rows the moment they're written, so search is always fresh — no pipeline to maintain.", cta: 'Add auto-embed' },
  },
  memoryPolicy: { powered: ['ZeroMemory'], nudge: null },
  agentDef: {
    powered: ['Agent Cloud', 'Model Catalog', 'AI Kit Safety'],
    nudge: { prim: 'Agent Observability', text: "Let me wire traces + cost tracking so you see exactly what every agent run costs and does.", cta: 'Add Observability' },
  },
  apiSpec: { powered: ['MCP', 'Tools'], nudge: null },
  backlog: { powered: ['Sequential Thinking'], nudge: null },
  swarm: { powered: ['Agent Cloud', 'Agent Swarm'], nudge: null },
  infra: { powered: ['ZeroDB', 'ZeroDB Files', 'OAuth 2.1'], nudge: null },
  preview: {
    powered: ['AI Kit', 'ZeroDB'],
    nudge: { prim: 'Instant DB', to: 'infra', text: "Your waitlist needs to persist for real — I'll spin up a live ZeroDB table, zero setup.", cta: 'Make it live' },
  },
  // ---- Company Track ----
  thesis: {
    powered: ['ZeroMemory', 'GraphRAG'],
    nudge: { prim: 'Data Marketplace', text: "I can pull enriched market data on 290K businesses to back this thesis with evidence, not guesses.", cta: 'Add market data' },
  },
  wedge: { powered: ['ZeroMemory'], nudge: null },
  businessModel: {
    powered: ['Model Catalog'],
    nudge: { prim: 'ZeroInvoice', text: "The moment you have a paying customer, I want billing ready — ZeroInvoice does Stripe + QuickBooks out of the box.", cta: 'Wire billing' },
  },
  positioning: { powered: ['ZeroMemory'], nudge: null },
  landing: {
    powered: ['AI Kit'],
    nudge: { prim: 'ZeroPipeline', to: 'pipeline', text: "This page will capture leads — wire ZeroPipeline so Scout follows up and Closer runs the deal while you sleep.", cta: 'Add the Pipeline' },
  },
  plan30: { powered: ['Sequential Thinking'], nudge: null },
  // ---- Shared / late ----
  pipeline: {
    powered: ['ZeroPipeline', 'Agent Cloud', 'ZeroInvoice'],
    nudge: { prim: 'ZeroVoice', text: "Some deals need a call. ZeroVoice lets Closer dial or text prospects directly — with compliance handled.", cta: 'Add Voice & SMS' },
  },
  conflict: { powered: ['ZeroMemory', 'Knowledge Graph'], nudge: null },
  graph: { powered: ['Knowledge Graph'], nudge: null },
}

/**
 * "/34" denominator — the real distinct-primitive count Builder composes from
 * (docs/AINATIVE_PRIMITIVES.md). Kept as a named const so it's one source of
 * truth for the "N/TOTAL woven" counter in the act-bar.
 */
export const TOTAL_PRIMITIVES = 34
