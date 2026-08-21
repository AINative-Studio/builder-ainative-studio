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

export default function Home() {
  const isDevelopment = process.env.NODE_ENV === 'development'

  // Keep the dev setup screen when env vars are missing (local onboarding only).
  if (!hasEnvVars && isDevelopment) {
    const missingVars = checkRequiredEnvVars()
    return <EnvSetup missingVars={missingVars} />
  }

  return <BuildApp />
}
