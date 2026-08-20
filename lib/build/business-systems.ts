/**
 * Business-systems model for the Live dashboard (#233).
 *
 * Each business system on the Live dashboard maps to a real AINative primitive
 * product. For a company just shipped from /build, the honest state is zero
 * (no deals/invoices/tickets/calls yet) — the nightly loop fills these. This
 * module defines the systems, their real primitive product URLs (so the cards
 * are live links, not dead buttons), and the shape the /api/build/systems
 * endpoint returns per company.
 */

export interface BusinessSystem {
  key: 'pipeline' | 'invoices' | 'helpdesk' | 'voice'
  name: string
  primitive: string
  /** real AINative product the card links to */
  url: string
  /** live stat line (zero-state for a new company; filled from real data when present) */
  stat: string
  /** numeric counters — real per-company values (0 for a fresh company) */
  count: number
  value?: number
}

const PRODUCT_URLS: Record<BusinessSystem['key'], string> = {
  pipeline: 'https://zeropipeline.ainative.studio',
  invoices: 'https://zeroinvoice.ainative.studio',
  helpdesk: 'https://helpdesk.ainative.studio',
  voice: 'https://ainative.studio/products/zerovoice',
}

/**
 * Build the systems list for a company from its real counts. Missing/zero
 * counts render the honest ready/zero-state. `counts` comes from the company's
 * real primitive data (via /api/build/systems); defaults to all-zero.
 */
export function buildSystems(counts: Partial<Record<BusinessSystem['key'], { count?: number; value?: number }>> = {}): BusinessSystem[] {
  const c = (k: BusinessSystem['key']) => counts[k]?.count ?? 0
  const v = (k: BusinessSystem['key']) => counts[k]?.value ?? 0

  return [
    {
      key: 'pipeline', name: 'Pipeline', primitive: 'ZeroPipeline', url: PRODUCT_URLS.pipeline,
      count: c('pipeline'), value: v('pipeline'),
      stat: c('pipeline') > 0 ? `${c('pipeline')} open · $${(v('pipeline') / 1000).toFixed(0)}k` : 'Ready · Scout sourcing',
    },
    {
      key: 'invoices', name: 'Invoices', primitive: 'ZeroInvoice', url: PRODUCT_URLS.invoices,
      count: c('invoices'), value: v('invoices'),
      stat: v('invoices') > 0 ? `$${(v('invoices') / 1000).toFixed(1)}k collected` : 'Ready · $0 collected',
    },
    {
      key: 'helpdesk', name: 'Helpdesk', primitive: 'ServiceOS', url: PRODUCT_URLS.helpdesk,
      count: c('helpdesk'),
      stat: c('helpdesk') > 0 ? `${c('helpdesk')} open tickets` : 'Ready · 0 tickets',
    },
    {
      key: 'voice', name: 'Voice & SMS', primitive: 'ZeroVoice', url: PRODUCT_URLS.voice,
      count: c('voice'),
      stat: c('voice') > 0 ? `${c('voice')} calls` : 'Ready · 0 calls',
    },
  ]
}
