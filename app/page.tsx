import type { Metadata } from 'next'
import { BuildApp } from '@/components/build/BuildApp'
import { EnvSetup } from '@/components/env-setup'
import { hasEnvVars, checkRequiredEnvVars } from '@/lib/env-check'

/**
 * The front door (#207): the root IS the company+app builder — one page, two
 * experiences (Build an App / Build a Company). We render the same BuildApp the
 * /build route serves, so `/` is a first-class canonical page (best for ads/SEO/
 * sharing) that IS the real product — no redirect, and the legacy app-builder
 * landing never surfaces. SEO/marketing routes (/ai-company, /compare, /guides,
 * /showcase) remain their own pages.
 */
export const metadata: Metadata = {
  title: 'AINative Builder — AI that builds AND runs your company',
  description:
    'Describe an idea, and Cody (your AI co-founder) composes it into a working product or an operating AI-native company from real AINative primitives, then runs it 24/7. Build an app or a company — one place.',
  keywords: [
    'AI that runs your company', 'AI co-founder', 'autonomous AI company', 'Polsia alternative',
    'AI business builder', 'build a company with AI', 'agent-run company', 'AI startup generator',
    'AI-native company', 'nightly AI operations', 'agent swarm', 'build an app with AI',
  ],
  alternates: { canonical: 'https://builder.ainative.studio/' },
}

// Product (not WebApplication/SoftwareApplication) — those app types require a
// star rating for Google Rich Results eligibility, and we never fabricate rating
// data that doesn't exist (#517). Prices mirror the real tiers in
// lib/build/pricing-tiers.ts — do not hand-maintain a separate figure here.
const productJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'AINative Builder',
  url: 'https://builder.ainative.studio',
  description:
    'An AI co-founder that builds AND runs your company: describe an idea and Cody composes a real running product plus the business systems around it, launches it, and operates it 24/7 on real AINative primitives you own.',
  category: 'DeveloperApplication',
  brand: { '@type': 'Organization', name: 'AINative Studio', url: 'https://ainative.studio' },
  offers: {
    '@type': 'AggregateOffer',
    lowPrice: '0',
    highPrice: '199',
    priceCurrency: 'USD',
    offerCount: 4,
    url: 'https://builder.ainative.studio/pricing',
  },
}

const webSiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'AINative Builder',
  url: 'https://builder.ainative.studio',
  potentialAction: {
    '@type': 'SearchAction',
    target: 'https://builder.ainative.studio/templates?search={search_term_string}',
    'query-input': 'required name=search_term_string',
  },
}

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'AINative Studio',
  url: 'https://ainative.studio',
  logo: 'https://builder.ainative.studio/ainative-logo-v2.png',
  description:
    'AINative Studio builds AINative Builder, an AI co-founder product that builds and runs companies on open primitives (ZeroDB, ZeroPipeline, ZeroInvoice, ServiceOS, ZeroVoice).',
  sameAs: ['https://github.com/AINative-Studio', 'https://twitter.com/AINativeStudio'],
}

export default function Home() {
  const isDevelopment = process.env.NODE_ENV === 'development'

  // Keep the dev setup screen when env vars are missing (local onboarding only).
  if (!hasEnvVars && isDevelopment) {
    const missingVars = checkRequiredEnvVars()
    return <EnvSetup missingVars={missingVars} />
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }} />
      <BuildApp />
    </>
  )
}
