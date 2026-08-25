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
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AppHeader } from '@/components/shared/app-header'

// ── Tier data (canonical source: components/build/screens/Pricing.tsx) ────────
// Replicated as plain objects so this SSR page has NO client-component imports.
// If tiers change, update both files (or extract to a shared lib/data file).

export const PRICING_TIERS = [
  {
    id: 'free',
    name: 'Free',
    monthly: 0,
    tagline: 'Try Cody. Build your first app.',
    featured: false,
    features: [
      'Cody builds a preview app from your idea',
      'Shareable live URL',
      'No credit card required',
      'AINative open primitives (read)',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    monthly: 49,
    tagline: 'Build it for real.',
    featured: true,
    features: [
      'Cody builds your app + company',
      '1M tokens · 50K API calls · 10 GB storage',
      'Real generation (Claude Sonnet 4.5)',
      'Custom domain available',
    ],
  },
  {
    id: 'business',
    name: 'Business',
    monthly: 199,
    tagline: 'Cody runs it 24/7.',
    featured: false,
    features: [
      'Everything in Pro',
      'The nightly autonomous loop',
      'Sales pipeline · invoicing · helpdesk · voice',
      '5M tokens · 150K API calls · 50 GB storage',
    ],
  },
] as const

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
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPageJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />

      <AppHeader />

      <main id="pricing-main" className="container mx-auto px-4 py-16 max-w-5xl">
        {/* Hero */}
        <header className="text-center mb-16">
          <p className="text-sm text-muted-foreground uppercase tracking-widest mb-3 font-medium">
            Pricing
          </p>
          <h1 className="text-4xl md:text-5xl font-semibold leading-tight mb-6">
            Build your company with Cody
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Start free. Cody builds your real app on open primitives you own. Upgrade when you
            want him to run the company around it — 24/7, autonomously. No revenue share.
          </p>
        </header>

        {/* Tier cards */}
        <section aria-label="Pricing tiers" className="mb-20">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6" data-testid="pricing-tiers">
            {PRICING_TIERS.map((tier) => (
              <div
                key={tier.id}
                id={tier.id}
                className={[
                  'rounded-2xl border p-8 flex flex-col',
                  tier.featured
                    ? 'border-foreground bg-foreground text-background shadow-lg'
                    : 'border-border bg-card text-card-foreground',
                ].join(' ')}
                data-testid={`tier-${tier.id}`}
              >
                {tier.featured && (
                  <p className="text-xs font-semibold uppercase tracking-widest mb-4 opacity-70">
                    Most popular
                  </p>
                )}
                <div className="mb-2">
                  <span className="text-sm font-medium uppercase tracking-wider opacity-60">
                    {tier.name}
                  </span>
                </div>
                <div className="mb-2" data-testid={`price-${tier.id}`}>
                  {tier.monthly === 0 ? (
                    <span className="text-4xl font-bold">Free</span>
                  ) : (
                    <>
                      <span className="text-4xl font-bold">${tier.monthly}</span>
                      <span className="text-base opacity-60">/mo</span>
                    </>
                  )}
                </div>
                <p className="text-sm opacity-70 mb-6">{tier.tagline}</p>

                <ul className="space-y-3 mb-8 flex-1">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <span aria-hidden="true" className="mt-0.5 shrink-0">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                <Button
                  asChild
                  size="lg"
                  variant={tier.featured ? 'secondary' : 'default'}
                  className="w-full"
                  data-testid={`cta-${tier.id}`}
                >
                  <Link href="/build">
                    {tier.monthly === 0 ? 'Start Free' : `Get ${tier.name}`}
                  </Link>
                </Button>
              </div>
            ))}
          </div>

          <p className="text-center text-sm text-muted-foreground mt-6">
            You own 100% of everything Cody builds. Cancel anytime.
          </p>
        </section>

        {/* FAQ */}
        <section aria-label="Frequently asked questions" className="max-w-2xl mx-auto mb-16">
          <h2 className="text-2xl font-semibold mb-8 text-center">Frequently asked questions</h2>
          <dl className="space-y-6">
            {faqEntries.map(({ q, a }) => (
              <div key={q} className="border-b border-border pb-6 last:border-0 last:pb-0">
                <dt className="font-medium mb-2">{q}</dt>
                <dd className="text-muted-foreground text-sm leading-relaxed">{a}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Bottom CTA */}
        <div className="text-center pt-8 border-t border-border">
          <p className="text-muted-foreground mb-6">Ready to meet Cody?</p>
          <Button asChild size="lg">
            <Link href="/build">Start Building Free</Link>
          </Button>
        </div>
      </main>

      {/* Footer nav — mirror pattern from /about */}
      <footer className="border-t border-border mt-8 py-8" data-agent-role="navigation">
        <div className="container mx-auto px-4 max-w-5xl">
          <nav
            className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground justify-center"
            aria-label="Footer navigation"
          >
            <Link href="/" className="hover:text-foreground transition-colors">
              Home
            </Link>
            <Link href="/build" className="hover:text-foreground transition-colors">
              Builder
            </Link>
            <Link href="/showcase" className="hover:text-foreground transition-colors">
              Showcase
            </Link>
            <Link href="/guides" className="hover:text-foreground transition-colors">
              Guides
            </Link>
            <Link href="/templates" className="hover:text-foreground transition-colors">
              Templates
            </Link>
            <Link href="/compare/polsia" className="hover:text-foreground transition-colors">
              Compare
            </Link>
            <Link href="/about" className="hover:text-foreground transition-colors">
              About
            </Link>
            <Link
              href="/pricing"
              className="hover:text-foreground transition-colors font-medium text-foreground"
              aria-current="page"
            >
              Pricing
            </Link>
          </nav>
          <p className="text-center text-xs text-muted-foreground mt-4">
            &copy; {new Date().getFullYear()} {ORG_NAME}. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
