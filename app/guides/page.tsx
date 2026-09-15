import type { Metadata } from 'next'
import Link from 'next/link'
import { PublicNav } from '@/components/shared/public-nav'
import { PublicFooter } from '@/components/shared/public-footer'
import { GUIDES } from '@/lib/data/seo-guides'

const BASE_URL = 'https://builder.ainative.studio'

export const metadata: Metadata = {
  title: 'Guides & Tutorials — Build Apps with AI | AINative Builder',
  description:
    'Long-form guides on building SaaS with AI, AI app builder comparisons (v0 vs Lovable vs AINative), AX optimization, and SEO best practices for AI-generated apps.',
  keywords: [
    'AI app builder guides',
    'how to build a SaaS with AI',
    'v0 vs Lovable vs AINative',
    'what is AX optimization',
    'SEO for AI-generated apps',
    'AINative Builder tutorials',
  ],
  openGraph: {
    title: 'Guides & Tutorials — Build Apps with AI | AINative Builder',
    description:
      'Long-form guides on building SaaS with AI, builder comparisons, AX optimization, and SEO best practices.',
    type: 'website',
    url: `${BASE_URL}/guides`,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Guides & Tutorials — Build Apps with AI | AINative Builder',
    description:
      'Long-form guides on building SaaS with AI, builder comparisons, AX optimization, and SEO best practices.',
  },
  alternates: {
    canonical: `${BASE_URL}/guides`,
  },
}

export default function GuidesIndexPage() {
  // ItemList structured data helps search engines understand the article hub.
  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'AINative Builder Guides',
    itemListElement: GUIDES.map((guide, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${BASE_URL}/guides/${guide.slug}`,
      name: guide.title,
    })),
  }

  return (
    <div className="modernist" style={{ minHeight: '100vh' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />
      <PublicNav />

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '48px 24px' }}>
        {/* Header */}
        <div style={{ marginBottom: 40, textAlign: 'center' }}>
          <p className="m-eyebrow" style={{ marginBottom: 16 }}>Guides &amp; Tutorials</p>
          <h1 className="m-h1" style={{ margin: '0 auto 16px' }}>Learn to build apps with AI</h1>
          <p style={{ fontSize: 17, color: 'var(--text-muted)', maxWidth: 640, marginInline: 'auto' }}>
            In-depth guides on building SaaS with AI, comparing AI app builders,
            optimizing for AI agents (AX), and making AI-generated apps rank in
            search.
          </p>
        </div>

        {/* Article grid */}
        <div style={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', background: 'var(--color-divider)' }}>
          {GUIDES.map((guide) => (
            <Link
              key={guide.slug}
              href={`/guides/${guide.slug}`}
              style={{ display: 'flex', flexDirection: 'column', background: 'var(--color-bg)', padding: 24, textDecoration: 'none', color: 'inherit', borderTop: '4px solid var(--color-divider)' }}
            >
              <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="m-mono" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--color-accent)' }}>
                  {guide.category}
                </span>
                <span className="m-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {guide.readTimeMinutes} min read
                </span>
              </div>
              <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 19, marginBottom: 8 }}>
                {guide.title}
              </h2>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, flex: 1 }}>
                {guide.excerpt}
              </p>
              <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {guide.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="m-mono" style={{ fontSize: 10.5, border: '1.5px solid var(--neutral-line)', padding: '3px 8px' }}>
                    {tag}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </main>
      <PublicFooter />
    </div>
  )
}
