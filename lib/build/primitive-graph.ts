/**
 * Primitive / component knowledge graph (#83 · Phase 7c, epic #303).
 *
 * Selection was flat trigger-matching: an idea's words → a set of primitives, with
 * no notion of WHICH AIKit components a given primitive/archetype implies. So a CRM
 * matched ZeroPipeline but the prompt never said "a CRM screen needs AIKitSidebar +
 * AIKitTable + MetricCard" — leaving the model to hand-roll them (aikit=0%).
 *
 * This models the missing relationships as a small in-repo graph:
 *
 *     archetype ──uses──▶ primitive
 *     archetype ──renders─▶ AIKit component
 *
 * so composition can traverse archetype → {primitives, components} and tell the
 * model the concrete components that archetype's surfaces need. Deterministic and
 * dependency-free (no external graph API — those endpoints 404 today; see #303),
 * but shaped so it can later be backed by ZeroMemory GraphRAG without changing callers.
 */

export interface ArchetypeNode {
  /** canonical archetype key */
  key: string
  /** words in the idea that map to this archetype */
  match: string[]
  /** primitives this archetype composes (by catalog name) */
  primitives: string[]
  /** AIKit components this archetype's surfaces render */
  components: string[]
}

/** The graph: archetype → (primitives, components). Edges are curated, not guessed. */
export const ARCHETYPE_GRAPH: ArchetypeNode[] = [
  { key: 'crm', match: ['crm', 'sales pipeline', 'deals', 'leads', 'contacts'],
    primitives: ['ZeroPipeline'],
    components: ['AIKitSidebar', 'AIKitHeader', 'AIKitTable', 'MetricCard', 'AIKitTimeline'] },
  { key: 'dashboard', match: ['dashboard', 'analytics', 'metrics', 'reports', 'kpi'],
    primitives: ['ZeroDB'],
    components: ['AIKitSidebar', 'AIKitHeader', 'MetricCard', 'AIKitTable'] },
  { key: 'ecommerce', match: ['store', 'shop', 'ecommerce', 'e-commerce', 'products', 'cart', 'checkout'],
    primitives: ['ZeroCommerce'],
    components: ['AIKitHeader', 'AIKitProductCard', 'AIKitPagination', 'AIKitRating'] },
  { key: 'invoicing', match: ['invoice', 'invoicing', 'billing', 'bill clients'],
    primitives: ['ZeroInvoice'],
    components: ['AIKitHeader', 'AIKitTable', 'MetricCard'] },
  { key: 'helpdesk', match: ['helpdesk', 'help desk', 'support', 'tickets', 'customer service'],
    primitives: ['ServiceOS'],
    components: ['AIKitSidebar', 'AIKitTable', 'AIKitBanner', 'AIKitAvatar'] },
  { key: 'nonprofit', match: ['nonprofit', 'non-profit', 'ngo', 'charity', 'donation', 'donor', 'fundraiser', 'grant', 'volunteer'],
    primitives: ['AINativeNGO'],
    components: ['AIKitSidebar', 'AIKitHeader', 'MetricCard', 'AIKitTable', 'AIKitTimeline'] },
  { key: 'equity', match: ['cap table', 'captable', 'equity', 'safe', 'vesting', 'investors', 'shares'],
    primitives: ['OpenCapStack'],
    components: ['AIKitHeader', 'AIKitTable', 'MetricCard'] },
  { key: 'content', match: ['content', 'blog', 'social media', 'newsletter', 'campaigns', 'posts'],
    primitives: ['Content Workflow'],
    components: ['AIKitHeader', 'AIKitTable', 'AIKitTimeline'] },
  { key: 'streaming', match: ['stream', 'streaming', 'live', 'broadcast', 'webinar', 'video'],
    primitives: ['Live Streaming'],
    components: ['AIKitHeader', 'AIKitAvatar', 'AIKitBanner'] },
  { key: 'voice', match: ['call', 'calls', 'phone', 'sms', 'telephony', 'voice', 'ivr'],
    primitives: ['ZeroVoice'],
    components: ['AIKitHeader', 'AIKitTable', 'AIKitTimeline'] },
]

/** Traverse the graph for an idea → the matched archetypes (may be >1). */
export function matchArchetypes(idea: string): ArchetypeNode[] {
  const text = (idea || '').toLowerCase()
  if (!text.trim()) return []
  return ARCHETYPE_GRAPH.filter((n) => n.match.some((m) => text.includes(m)))
}

/** Union of the AIKit components implied by an idea's matched archetypes. */
export function componentsForIdea(idea: string): string[] {
  const seen = new Set<string>()
  for (const n of matchArchetypes(idea)) for (const c of n.components) seen.add(c)
  return [...seen]
}

/**
 * A prompt block naming the concrete AIKit components this idea's surfaces need,
 * so the model reaches for them instead of hand-rolling. Empty when no archetype
 * matches (a generic idea keeps the default guidance).
 */
export function componentGuidanceBlock(idea: string): string {
  const comps = componentsForIdea(idea)
  if (!comps.length) return ''
  return (
    '\n\n### COMPONENTS THIS APP NEEDS (use these AIKit components, do not hand-roll):\n' +
    comps.map((c) => `- <${c} />`).join('\n') +
    '\n(These are the surfaces this kind of app has. Import them from ./components/aikit.)\n'
  )
}
