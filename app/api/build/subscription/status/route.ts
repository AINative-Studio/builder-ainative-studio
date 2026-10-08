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
import { fetchCorePlanIdentity } from '@/lib/ainative/resolve-plan'
import { reconcilePlanFulfillment } from '@/lib/build/app-registry'

export const runtime = 'nodejs'

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

export async function GET(request: NextRequest) {
  const session = await auth()
  const token = (session as any)?.accessToken as string | undefined
  if (!token) return Response.json({ plan: null, signedIn: false })

  const slug = request.nextUrl.searchParams.get('slug')?.trim()

  // #762: resolved through the SAME shared `/api/v1/auth/me` reader that
  // getPlanStatus() and every other paid gate now use, so this route and the
  // entitlement checks can no longer disagree about the same account.
  const identity = await fetchCorePlanIdentity(token)
  if (!identity.verified) return Response.json({ plan: null, signedIn: true })

  // SUPER-ADMIN / STAFF BYPASS (#309): AINative admins must have full Builder
  // access regardless of their subscription row. Without this, an admin whose
  // plan is empty — or absent from /me entirely — was shown "Upgrade to hire the
  // swarm" (the reported bug). Treat admins as enterprise.
  //
  // #1022: this bypass used to RETURN HERE, before the reconciliation below was
  // ever reached — one of two independent, stacking reasons an admin account's
  // companies could never be repaired. (The other: `PLAN_MAP['admin']` is
  // undefined, so `activePlan` was null and the reconcile gate failed even
  // without the early return. Both are fixed — the plan vocabulary now resolves
  // 'admin' ⇒ enterprise in the ONE consolidated place, lib/ainative/plan.ts.)
  //
  // Admins DO need reconciliation, because admin-ness belongs to the FOUNDER
  // while the stuck state lives on the COMPANY's registry row — and that row's
  // readers cannot see who owns it. `lib/build/deploy.ts`'s
  // `isPaidPlan(entry.plan)`, which `subdomainServable` and therefore
  // middleware's wildcard-host serving depend on, takes only
  // `{plan, subdomainClaimed}`. So an admin-owned company left on `plan: null`
  // never gets `{slug}.ainative.studio` served, has `claimSubdomain` refuse it
  // as `not_paid`, and never sets `enrolled` for the nightly loop, however
  // privileged its owner is. #1014 fixed this for NEW provisions (getPlanStatus
  // maps admin ⇒ enterprise, so `livePaid` is true there); companies already
  // broken before that landed can only be repaired here.
  const activePlan = identity.admin ? 'enterprise' : PLAN_MAP[identity.rawPlan ?? ''] || null

  // Real bug fix (agentive/amador@selfpreneur.com, a real paying Pro
  // customer): the ONLY place a company's registry plan/key state ever gets
  // fixed is subscription/verify, which only runs on a completed Stripe
  // redirect round-trip — no webhook exists, so a closed tab/network blip
  // there leaves a genuinely paying founder's company permanently stuck with
  // plan:null and a tmp_ key. This runs on every Live dashboard load for a
  // slug the caller already knows about (not a background sweep — the claim
  // step needs THIS founder's own real session token, never borrowed or
  // impersonated), and is a strict no-op unless we've just confirmed they are
  // genuinely on a real, paid plan. Best-effort: never blocks or fails this
  // response either way.
  //
  // #1022: the plan handed to reconciliation is `activePlan` (canonical), NOT
  // the raw `identity.rawPlan`. For an admin that raw value is the literal
  // 'admin', and `reconcilePlanFulfillment` writes what it is given straight
  // onto the registry row via `setAppPlan` — so passing it through would have
  // persisted a plan string that `deploy.ts`'s `isPaidPlan`, `claimSubdomain`
  // and `setAppPlan`'s own `enrolled` flag all read as UNPAID, leaving the
  // company exactly as stuck while looking repaired. That is the alias-vs-
  // canonical defect from #1012's review in a new disguise, and `activePlan`
  // is already the canonical form every one of those readers expects.
  if (slug && activePlan) {
    reconcilePlanFulfillment(slug, activePlan, token).catch(() => {})
  }

  // Staff response shape is unchanged (#309) — the Live dashboard already
  // consumes `admin: true` + `rawPlan: 'admin'`; only its POSITION moved, to
  // after the reconciliation above.
  if (identity.admin) {
    return Response.json({
      plan: 'enterprise', rawPlan: 'admin', signedIn: true, admin: true,
      email: identity.email, trialExpiresAt: null,
    })
  }

  return Response.json({
    plan: activePlan, // Builder ActivePlan or null
    rawPlan: identity.rawPlan,                      // the underlying core plan id
    signedIn: true,
    email: identity.email,
    trialExpiresAt: identity.trialExpiresAt,
  })
}
