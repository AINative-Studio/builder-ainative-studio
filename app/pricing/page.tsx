/**
 * /pricing — Public SSR pricing page
 *
 * Ad-landing + SEO/AEO asset. Crawlable without an account (allowlisted in
 * middleware.ts). Tier data is derived from the canonical TIERS definition in
 * components/build/screens/Pricing.tsx — do NOT duplicate values here.
 *
 * JSON-LD: FAQPage + Product/Offer schemas.
 */

import type { Metadata } from 'next'
import { PRICING_TIERS } from '@/lib/build/pricing-tiers'
import Link from 'next/link'
import { PublicNav } from '@/components/shared/public-nav'
import { PublicFooter } from '@/components/shared/public-footer'

// ── Tier data (canonical source: components/build/screens/Pricing.tsx) ────────
// Replicated as plain objects so this SSR page has NO client-component imports.
// If tiers change, update both files (or extract to a shared lib/data file).


// ── Page metadata ─────────────────────────────────────────────────────────────

const PAGE_URL = 'https://builder.ainative.studio/pricing'
const ORG_NAME = 'AINative Studio'
const ORG_URL = 'https://ainative.studio'

export const metadata: Metadata = {
  title: 'Pricing — AINative Builder | Free, Pro $49/mo, Business $199/mo',
  description:
    'AINative Builder pricing: start free, then Pro at $49/month (Cody builds your real app) or Business at $199/month (Cody runs your company 24/7). No revenue share. You own 100%.',
  keywords: [
    'AINative Builder pricing',
    'Cody AI builder price',
    'AI company builder cost',
    'AINative plans',
    'AI co-founder pricing',
    'build AI app price',
    'autonomous company pricing',
  ],
  openGraph: {
    title: 'AINative Builder Pricing — Free, Pro $49/mo, Business $199/mo',
    description:
      'Start free. Upgrade to Pro ($49/mo) for a real app Cody builds, or Business ($199/mo) for autonomous 24/7 operations. No revenue share.',
    type: 'website',
  },
  alternates: {
    canonical: PAGE_URL,
  },
}

// ── JSON-LD ──────────────────────────────────────────────────────────────────

const faqEntries = [
  {
    q: 'Is there a free plan?',
    a: 'Yes. The Free plan lets you try Cody and generate a live preview app from your idea with no credit card required.',
  },
  {
    q: 'What is included in the Pro plan?',
    a: 'Pro ($49/month) includes real app generation by Cody (Claude Sonnet 4.5), 1M tokens, 50K API calls, 10 GB storage, and a custom domain option.',
  },
  {
    q: 'What does the Business plan add?',
    a: 'Business ($199/month) adds the nightly autonomous loop — Cody runs your sales pipeline, invoicing, helpdesk, and voice — plus 5M tokens, 150K API calls, and 50 GB storage.',
  },
  {
    q: 'Do you take a revenue share?',
    a: 'No. You own 100% of everything Cody builds. There is no revenue share, no equity, no lock-in.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Subscriptions are month-to-month and can be cancelled at any time from your account settings.',
  },
  {
    q: 'What does "you own 100%" mean?',
    a: 'Everything Cody generates — code, data, domain, infrastructure — is yours. AINative Builder is built on open primitives (ZeroDB, ZeroPipeline, ZeroInvoice, ServiceOS, ZeroVoice) that you can inspect, extend, or migrate away from at any time.',
  },
]

const faqPageJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqEntries.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
}

// One Product block with Offer per paid tier so search engines can show price snippets.
const productJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'AINative Builder',
  description:
    'Cody — your AI co-founder — builds a real app from your idea, then runs the company autonomously. No revenue share, 100% ownership.',
  url: PAGE_URL,
  brand: { '@type': 'Organization', name: ORG_NAME, url: ORG_URL },
  offers: [
    {
      '@type': 'Offer',
      name: 'Free',
      price: '0',
      priceCurrency: 'USD',
      description: 'Try Cody and get a live preview app — no credit card required.',
      url: `${PAGE_URL}#free`,
      availability: 'https://schema.org/InStock',
    },
    {
      '@type': 'Offer',
      name: 'Pro',
      price: '49',
      priceCurrency: 'USD',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: '49',
        priceCurrency: 'USD',
        unitCode: 'MON',
      },
      description: 'Cody builds your real app and company. 1M tokens, 50K API calls, custom domain.',
      url: `${PAGE_URL}#pro`,
      availability: 'https://schema.org/InStock',
    },
    {
      '@type': 'Offer',
      name: 'Business',
      price: '199',
      priceCurrency: 'USD',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: '199',
        priceCurrency: 'USD',
        unitCode: 'MON',
      },
      description:
        'Cody runs your company 24/7: autonomous loop, CRM, invoicing, helpdesk, voice. 5M tokens, 150K API calls.',
      url: `${PAGE_URL}#business`,
      availability: 'https://schema.org/InStock',
    },
  ],
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  return (
    <div className="modernist" style={{ minHeight: '100vh' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPageJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />

      <PublicNav />

      <main id="pricing-main" style={{ maxWidth: 1080, margin: '0 auto', padding: '64px 24px' }}>
        {/* Hero */}
        <header style={{ textAlign: 'center', marginBottom: 64 }}>
          <p className="m-eyebrow" style={{ marginBottom: 12 }}>Pricing</p>
          <h1 className="m-h1" style={{ margin: '0 auto 20px' }}>Build your company with Cody</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 18, maxWidth: 640, margin: '0 auto' }}>
            Start free. Cody builds your real app on open primitives you own. Upgrade when you
            want him to run the company around it — 24/7, autonomously. No revenue share.
          </p>
        </header>

        {/* Tier cards */}
        <section aria-label="Pricing tiers" style={{ marginBottom: 80 }}>
          <div
            className="m-tiers-responsive"
            style={{ display: 'grid', gap: 2, background: 'var(--color-divider)' }}
            data-testid="pricing-tiers"
          >
            {PRICING_TIERS.map((tier) => (
              <div
                key={tier.id}
                id={tier.id}
                style={{
                  padding: 32,
                  display: 'flex',
                  flexDirection: 'column',
                  background: tier.featured ? 'var(--ink)' : 'var(--color-bg)',
                  color: tier.featured ? '#f3f2f2' : 'var(--color-text)',
                  borderTop: tier.featured ? '4px solid var(--color-accent)' : '4px solid var(--color-divider)',
                }}
                data-testid={`tier-${tier.id}`}
              >
                {tier.featured && (
                  <p className="m-mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: 16, color: 'var(--color-accent)' }}>
                    Most popular
                  </p>
                )}
                <div style={{ marginBottom: 8 }}>
                  <span className="m-mono" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em', opacity: 0.7 }}>
                    {tier.name}
                  </span>
                </div>
                <div style={{ marginBottom: 8 }} data-testid={`price-${tier.id}`}>
                  {tier.monthly === 0 ? (
                    <span style={{ fontFamily: 'var(--font-heading)', fontSize: 36, fontWeight: 800 }}>Free</span>
                  ) : (
                    <>
                      <span style={{ fontFamily: 'var(--font-heading)', fontSize: 36, fontWeight: 800 }}>${tier.monthly}</span>
                      <span style={{ fontSize: 15, opacity: 0.7 }}>/mo</span>
                    </>
                  )}
                </div>
                <p style={{ fontSize: 14, opacity: 0.8, marginBottom: 24 }}>{tier.tagline}</p>

                <ul style={{ display: 'grid', gap: 12, marginBottom: 32, flex: 1, listStyle: 'none', padding: 0 }}>
                  {tier.features.map((f) => (
                    <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14 }}>
                      <span aria-hidden="true" style={{ color: 'var(--color-accent)', flexShrink: 0 }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                <Link
                  href="/build"
                  className={tier.featured ? 'btn-primary' : 'btn-secondary'}
                  style={{ textDecoration: 'none', justifyContent: 'center', width: '100%' }}
                  data-testid={`cta-${tier.id}`}
                >
                  {tier.monthly === 0 ? 'Start Free' : `Get ${tier.name}`}
                </Link>
              </div>
            ))}
          </div>

          <p className="m-mono" style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 24 }}>
            You own 100% of everything Cody builds. Cancel anytime.
          </p>
        </section>

        {/* FAQ */}
        <section aria-label="Frequently asked questions" style={{ maxWidth: 640, margin: '0 auto 64px' }}>
          <h2 className="m-h1" style={{ fontSize: 28, textAlign: 'center', margin: '0 auto 32px' }}>Frequently asked questions</h2>
          <dl style={{ display: 'grid', gap: 24 }}>
            {faqEntries.map(({ q, a }) => (
              <div key={q} style={{ borderBottom: '2px solid var(--color-divider)', paddingBottom: 24 }}>
                <dt style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, marginBottom: 8 }}>{q}</dt>
                <dd style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6 }}>{a}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Bottom CTA */}
        <div style={{ textAlign: 'center', paddingTop: 32, borderTop: '2px solid var(--color-divider)' }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>Ready to meet Cody?</p>
          <Link href="/build" className="btn-primary" style={{ textDecoration: 'none' }}>Start Building Free</Link>
        </div>
      </main>

      <PublicFooter />
    </div>
  )
}
