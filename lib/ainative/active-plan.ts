/**
 * Server-side ActivePlan resolution — the ONE place a route learns whether the
 * signed-in founder is on a paying AINative plan (pro/business/enterprise/
 * cody_vcto) or is staff (admins ⇒ enterprise).
 *
 * Extracted from /api/build/subscription/status (#251/#309) so paid-gated
 * routes (auto-mode, swarm, …) resolve the plan SERVER-side from the session →
 * core /auth/me — never from a client-sent body field. The auto-mode route used
 * to gate on `body.plan`, which the client never sent, so EVERY founder —
 * including Enterprise — got `not_paid` and was bounced to pricing.
 */

import { auth } from '@/app/(auth)/auth'
import type { ActivePlan } from '@/lib/build/state'

const CORE = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'

// Map core plan ids → Builder ActivePlan. hobbyist/free are NOT a paid tier.
const PLAN_MAP: Record<string, ActivePlan> = {
  pro: 'pro',
  business: 'business',
  enterprise: 'enterprise',
  cody_vcto: 'cody_vcto',
  // generous aliases the catalog sometimes emits
  launch: 'pro',
  company: 'business',
}

export interface ResolvedPlan {
  plan: ActivePlan          // '' when unpaid/anonymous OR verification failed — see `verified`
  rawPlan: string | null
  signedIn: boolean
  admin: boolean
  email: string | null
  trialExpiresAt: string | null
  /**
   * Whether `plan` reflects a REAL answer from core, as opposed to a fallback
   * after a timeout/5xx/network error. Real bug (live, enterprise account):
   * a single transient core `/auth/me` hiccup used to come back with the exact
   * same shape as a confirmed "no plan" — {plan:'', signedIn:true} — so a
   * paid-gated route's `isGated()` treated "couldn't verify right now" and
   * "genuinely not paid" identically, silently bouncing a real, paying
   * Enterprise founder to the pricing/checkout screen on a blip they had no
   * part in. Callers that hard-redirect on `!planUnlocks(plan).X` MUST check
   * `verified` first and fail toward "can't tell yet" (not "must upgrade")
   * when it's false.
   */
  verified: boolean
}

const NONE: ResolvedPlan = {
  plan: '', rawPlan: null, signedIn: false, admin: false, email: null, trialExpiresAt: null, verified: true,
}

/** Resolve the caller's ActivePlan from their session (core /auth/me). A plan
 *  of '' can mean either "confirmed unpaid" or "verification failed" — always
 *  check `verified` before treating '' as a real answer (see `verified` doc). */
export async function resolveActivePlan(): Promise<ResolvedPlan> {
  const session = await auth().catch(() => null)
  const token = (session as any)?.accessToken as string | undefined
  if (!token) return NONE

  try {
    const res = await fetch(`${CORE}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return { ...NONE, signedIn: true, verified: false }
    const me = await res.json().catch(() => null)
    const inner = me?.data || me || {}

    // Staff bypass (#309): admins get full Builder access (⇒ enterprise).
    const role = String(inner.role || me?.role || '').toUpperCase()
    const isAdmin = role === 'ADMIN' || role === 'SUPERUSER' ||
      inner.is_superuser === true || inner.is_admin === true
    if (isAdmin) {
      return {
        plan: 'enterprise', rawPlan: 'admin', signedIn: true, admin: true,
        email: inner.email || me?.email || null, trialExpiresAt: null, verified: true,
      }
    }

    // #309: read the tier from every field core might expose it under.
    const raw = String(
      inner.plan || inner.subscription_tier || inner.tier ||
      inner.subscription?.tier || me?.plan || ''
    ).toLowerCase()
    return {
      plan: PLAN_MAP[raw] || '',
      rawPlan: raw || null,
      signedIn: true,
      admin: false,
      email: inner.email || me?.email || null,
      trialExpiresAt: inner.trial_expires_at || me?.trial_expires_at || null,
      verified: true,
    }
  } catch {
    return { ...NONE, signedIn: true, verified: false }
  }
}
