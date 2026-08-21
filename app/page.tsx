import { redirect } from 'next/navigation'
import { EnvSetup } from '@/components/env-setup'
import { hasEnvVars, checkRequiredEnvVars } from '@/lib/env-check'

/**
 * The front door is the new /build company+app builder UX (#207). The legacy
 * app-builder landing page must NOT surface — the root redirects into /build so
 * every visitor lands in the real product flow. SEO/marketing content lives on its
 * own routes (/ai-company, /compare, /guides, /showcase), which are unaffected.
 */
export default function Home() {
  const isDevelopment = process.env.NODE_ENV === 'development'

  // Keep the dev setup screen when env vars are missing (local onboarding only).
  if (!hasEnvVars && isDevelopment) {
    const missingVars = checkRequiredEnvVars()
    return <EnvSetup missingVars={missingVars} />
  }

  redirect('/build')
}
