import type { Metadata } from 'next'
import Link from 'next/link'
import { PublicNav } from '@/components/shared/public-nav'
import { PublicFooter } from '@/components/shared/public-footer'
import { CAPABILITIES } from '@/lib/build/capabilities'

const PAGE_URL = 'https://builder.ainative.studio/capabilities'

export const metadata: Metadata = {
  title: 'What can I build? — AINative Builder capabilities',
  description:
    'Plain-English overview of what you can build with AINative: a CRM, an online store, invoicing, a helpdesk, phone/SMS, a nonprofit backend, and more — each included, no extra keys or subscriptions.',
  alternates: { canonical: PAGE_URL },
}

// ItemList (not a rating-requiring app schema, matching #517's Product-not-
// WebApplication precedent) so search/answer engines can enumerate the real,
// included primitives instead of only the raw prose.
const itemListJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'What you can build with AINative Builder',
  description:
    'The real AINative primitives Cody composes from, each included with no extra signup, key, or subscription.',
  numberOfItems: CAPABILITIES.length,
  itemListElement: CAPABILITIES.map((c, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: c.product,
    description: `${c.build} Replaces: ${c.replaces}.`,
  })),
}

// FAQPage from the natural "what does AINative replace" questions this page
// already answers per-capability — real content, not invented Q&A.
const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: CAPABILITIES.map((c) => ({
    '@type': 'Question',
    name: `Can I build ${c.examples[0]} with AINative Builder?`,
    acceptedAnswer: {
      '@type': 'Answer',
      text: `Yes — ${c.build} This is included with no extra signup, key, or subscription, and replaces tools like ${c.replaces}.`,
    },
  })),
}

/**
 * /capabilities (#313 GR-04 / #316 GR-07) — the plain-English "what can I build"
 * surface. Cody's discovery routing points here for capability-discovery intents
 * (NOT the raw API reference). Sourced from lib/build/capabilities.ts.
 */
export default function CapabilitiesPage() {
  return (
    <div className="modernist" style={{ minHeight: '100vh' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <PublicNav />
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '48px 24px' }}>
        <div style={{ marginBottom: 40 }}>
          <p className="m-eyebrow">AINative Builder</p>
          <h1 className="m-h1" style={{ fontSize: 34, margin: '8px 0 12px' }}>What can I build?</h1>
          <p style={{ maxWidth: 640, color: 'var(--text-muted)' }}>
            Describe an idea and Cody builds it on real AINative products — each one included,
            with no extra signup, key, or subscription. Here’s what’s available, in plain English.
          </p>
        </div>

        <div style={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', background: 'var(--color-divider)' }}>
          {CAPABILITIES.map((c) => (
            <div key={c.product} style={{ background: 'var(--color-bg)', padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 17 }}>{c.product}</h2>
                <span className="m-mono" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--success)' }}>
                  included
                </span>
              </div>
              <p style={{ marginTop: 8, fontSize: 14 }}>{c.build}</p>
              <ul style={{ marginTop: 12, display: 'grid', gap: 4, fontSize: 14, color: 'var(--text-muted)', listStyle: 'none', padding: 0 }}>
                {c.examples.map((ex) => (
                  <li key={ex} style={{ display: 'flex', gap: 8 }}>
                    <span aria-hidden style={{ color: 'var(--color-accent)' }}>→</span>
                    <span>{ex}</span>
                  </li>
                ))}
              </ul>
              <p className="m-mono" style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                <span style={{ fontWeight: 600 }}>Replaces:</span> {c.replaces}
              </p>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 48, background: 'var(--color-surface)', borderTop: '4px solid var(--color-accent)', padding: 32, textAlign: 'center' }}>
          <p>Got an idea? You don’t need to pick a product — just describe what you want.</p>
          <Link href="/build" className="btn-primary" style={{ textDecoration: 'none', marginTop: 16, display: 'inline-flex' }}>
            Start building →
          </Link>
        </div>
      </main>
      <PublicFooter />
    </div>
  )
}
