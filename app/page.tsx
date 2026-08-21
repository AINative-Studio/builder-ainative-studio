import { redirect } from 'next/navigation'
import { EnvSetup } from '@/components/env-setup'
import { hasEnvVars, checkRequiredEnvVars } from '@/lib/env-check'

/**
 * The front door is the /build company+app builder UX (#207) — one page, two
 * experiences (Build an App / Build a Company). The middleware redirects `/` →
 * `/build` on every request; this component is a belt-and-suspenders fallback for
 * any path that reaches it directly. The legacy app-builder landing must not surface.
 */
export const dynamic = 'force-dynamic'

export default function Home() {
  const isDevelopment = process.env.NODE_ENV === 'development'

  // Keep the dev setup screen when env vars are missing (local onboarding only).
  if (!hasEnvVars && isDevelopment) {
    const missingVars = checkRequiredEnvVars()
    return <EnvSetup missingVars={missingVars} />
  }

  redirect('/build')
}
