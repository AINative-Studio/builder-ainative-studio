/**
 * GET /api/build/subscription/status (#207 · #251) — recognize an EXISTING
 * AINative subscription so a signed-in paying user is NOT asked to pay again.
 *
 * Reads the signed-in user's plan from core (`/api/v1/auth/me` returns `plan`),
 * maps it to the Builder ActivePlan vocabulary, and returns it so Live can hydrate
 * `state.activePlan` on load. Anonymous / no plan → { plan: null }.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'

export const runtime = 'nodejs'

const CORE = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'

// Map core plan ids → Builder ActivePlan. Core uses hobbyist/pro/business/
// enterprise/cody_vcto; Builder gates on pro|business|enterprise|cody_vcto.
// hobbyist/free are NOT a Builder paid tier (they can't run a real company).
const PLAN_MAP: Record<string, string> = {
  pro: 'pro',
  business: 'business',
  enterprise: 'enterprise',
  cody_vcto: 'cody_vcto',
  // generous aliases the catalog sometimes emits
  launch: 'pro',
  company: 'business',
}

export async function GET(_request: NextRequest) {
  const session = await auth()
  const token = (session as any)?.accessToken as string | undefined
  if (!token) return Response.json({ plan: null, signedIn: false })

  try {
    const res = await fetch(`${CORE}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return Response.json({ plan: null, signedIn: true })
    const me = await res.json().catch(() => null)
    const inner = me?.data || me || {}

    // SUPER-ADMIN / STAFF BYPASS (#309): AINative admins must have full Builder
    // access regardless of their subscription row. core /auth/me returns `role`
    // (ADMIN | SUPERUSER | USER). Without this, an admin whose plan is empty — or
    // absent from /me entirely — was shown "Upgrade to hire the swarm" (the reported
    // bug). Treat admins as enterprise.
    const role = String(inner.role || me?.role || '').toUpperCase()
    const isAdmin = role === 'ADMIN' || role === 'SUPERUSER' ||
      inner.is_superuser === true || inner.is_admin === true
    if (isAdmin) {
      return Response.json({
        plan: 'enterprise', rawPlan: 'admin', signedIn: true, admin: true,
        email: inner.email || me?.email || null, trialExpiresAt: null,
      })
    }

    // #309: /auth/me's UserInfoResponse does NOT include `plan`, so `me.plan` was
    // ALWAYS undefined → every non-admin user gated too. Read the tier from every
    // field core might expose it under.
    const raw = String(
      inner.plan || inner.subscription_tier || inner.tier ||
      inner.subscription?.tier || me?.plan || ''
    ).toLowerCase()
    const plan = PLAN_MAP[raw] || null
    return Response.json({
      plan,                                   // Builder ActivePlan or null
      rawPlan: raw || null,                   // the underlying core plan id
      signedIn: true,
      email: inner.email || me?.email || null,
      trialExpiresAt: inner.trial_expires_at || me?.trial_expires_at || null,
    })
  } catch {
    return Response.json({ plan: null, signedIn: true })
  }
}
