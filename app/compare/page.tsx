import type { Metadata } from 'next'
import Link from 'next/link'
import { PublicNav } from '@/components/shared/public-nav'
import { PublicFooter } from '@/components/shared/public-footer'

// Crawlable index for the /compare/[competitor] pages. Keeps the "X alternative"
// SEO intent reachable from a single hub and reinforces the pivot positioning:
// AINative doesn't just generate code — it builds AND runs your company.
// Slugs here MUST match COMPETITORS in app/compare/[competitor]/page.tsx.

interface CompareTarget {
  slug: string
  name: string
  // How the market frames the competitor, and the one-line "why switch".
  kind: 'builder' | 'company'
  blurb: string
}

const COMPARE_TARGETS: CompareTarget[] = [
  {
    slug: 'polsia',
    name: 'Polsia',
    kind: 'company',
    blurb:
      'Polsia runs a company for you, but you bring the product — and it is a closed, client-rendered system. AINative builds the product first, then runs it 24/7 on real primitives you own.',
  },
  {
    slug: 'v0',
    name: 'v0 by Vercel',
    kind: 'builder',
    blurb:
      'v0 generates UI on GPT-4o alone. AINative composes a real running product and the operating company around it — multi-model, agent-native, and yours to keep.',
  },
  {
    slug: 'lovable',
    name: 'Lovable',
    kind: 'builder',
    blurb:
      'Lovable stops at a generated app. AINative goes further: a production-ready app plus CRM, billing, helpdesk and voice — then runs the whole thing while you sleep.',
  },
  {
    slug: 'bolt',
    name: 'Bolt.new',
    kind: 'builder',
    blurb:
      'Bolt.new is a code generator. AINative is an AI co-founder that builds AND runs your company on real, open primitives with automatic SEO and AX optimization.',
  },
  {
    slug: 'base44',
    name: 'Base44',
    kind: 'builder',
    blurb:
      'Base44 builds apps on a single model with no agent optimization. AINative is multi-model, agent-native, open-source, and operates your company autonomously.',
  },
]

export const metadata: Metadata = {
  title: 'AINative Builder Alternatives — Compare vs Polsia, v0, Lovable, Bolt, Base44',
  description:
    'Compare AINative Builder to Polsia, v0, Lovable, Bolt.new, and Base44. See why the AI that BUILDS and RUNS your company — on real, open primitives you own — beats code generators and closed autonomous-company tools.',
  keywords: [
    'AINative Builder alternatives',
    'Polsia alternative',
    'v0 alternative',
    'Lovable alternative',
    'Bolt.new alternative',
    'Base44 alternative',
    'AI that runs your company',
    'AI co-founder',
    'best AI app builder 2026',
  ],
  alternates: { canonical: 'https://builder.ainative.studio/compare' },
  openGraph: {
    title: 'AINative Builder vs Polsia, v0, Lovable, Bolt & Base44',
    description:
      'The AI that builds AND runs your company, compared side-by-side with the code generators and autonomous-company tools you already know.',
    type: 'website',
  },
}

const itemListJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'AINative Builder comparisons',
  itemListElement: COMPARE_TARGETS.map((t, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: `AINative Builder vs ${t.name}`,
    url: `https://builder.ainative.studio/compare/${t.slug}`,
  })),
}

export default function CompareIndexPage() {
  return (
    <div className="modernist" style={{ minHeight: '100vh' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />
      <PublicNav />

      <main>
        {/* Hero */}
        <section style={{ maxWidth: 900, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
          <p className="m-eyebrow" style={{ marginBottom: 16 }}>Comparisons</p>
          <h1 className="m-h1" style={{ margin: '0 auto 20px' }}>How AINative Builder compares</h1>
          <p style={{ fontSize: 19, color: 'var(--text-muted)', marginBottom: 32, maxWidth: 640, marginInline: 'auto' }}>
            Most tools either generate code or run a company you already have. AINative does
            both — Cody, your AI co-founder, builds the product AND the operating company on real,
            open primitives you own, then runs it 24/7. See how it stacks up.
          </p>
          <Link href="/build" className="btn-primary" style={{ textDecoration: 'none' }}>Build your company free →</Link>
        </section>

        {/* Comparison list */}
        <section style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px 64px' }}>
          <h2 className="m-h1" style={{ fontSize: 28, textAlign: 'center', margin: '0 auto 32px' }}>Side-by-side comparisons</h2>
          <ul style={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', background: 'var(--color-divider)', listStyle: 'none', padding: 0, margin: 0 }}>
            {COMPARE_TARGETS.map((t) => (
              <li key={t.slug}>
                <Link
                  href={`/compare/${t.slug}`}
                  style={{ display: 'block', height: '100%', background: 'var(--color-bg)', padding: 24, textDecoration: 'none', color: 'inherit', borderTop: '4px solid var(--color-divider)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
                    <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 18 }}>
                      AINative Builder vs {t.name}
                    </h3>
                    <span className="m-mono" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em', border: '1.5px solid var(--neutral-line)', padding: '3px 8px', whiteSpace: 'nowrap' }}>
                      {t.kind === 'company' ? 'Runs your company' : 'Code generator'}
                    </span>
                  </div>
                  <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>{t.blurb}</p>
                  <span className="m-mono" style={{ marginTop: 16, display: 'inline-block', color: 'var(--color-accent)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    Compare AINative vs {t.name} →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* Category context — keeps non-branded intent reachable */}
        <section style={{ maxWidth: 720, margin: '0 auto', padding: '0 24px 64px', textAlign: 'center' }}>
          <h2 className="m-h1" style={{ fontSize: 28, margin: '0 auto 16px' }}>Looking for the bigger picture?</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.6 }}>
            These comparisons focus on individual tools. If you want to understand the category —
            an AI that builds AND runs your company autonomously — start here.
          </p>
          <Link href="/ai-company" className="btn-secondary" style={{ textDecoration: 'none' }}>See what an AI co-founder can do →</Link>
        </section>

        {/* Bottom CTA */}
        <section style={{ borderTop: '2px solid var(--color-divider)', background: 'var(--color-surface)' }}>
          <div style={{ maxWidth: 640, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
            <h2 className="m-h1" style={{ fontSize: 32, margin: '0 auto 16px' }}>Ready to switch?</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 32 }}>
              Describe an idea and watch Cody build a real, production-ready company on primitives
              you own — then run it while you sleep.
            </p>
            <Link href="/build" className="btn-primary" style={{ textDecoration: 'none' }}>Build your company free →</Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
