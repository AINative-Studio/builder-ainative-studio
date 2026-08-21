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
    const raw = String(me?.plan || me?.data?.plan || '').toLowerCase()
    const plan = PLAN_MAP[raw] || null
    return Response.json({
      plan,                                   // Builder ActivePlan or null
      rawPlan: raw || null,                   // the underlying core plan id
      signedIn: true,
      email: me?.email || me?.data?.email || null,
      trialExpiresAt: me?.trial_expires_at || null,
    })
  } catch {
    return Response.json({ plan: null, signedIn: true })
  }
}
