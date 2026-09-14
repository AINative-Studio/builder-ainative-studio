/**
 * The ONE place Builder asks core "what plan is this user on?" (#762).
 *
 * WHY THIS MODULE EXISTS
 * Builder had TWO independent plan-resolution paths that could disagree about
 * the SAME account in the SAME session, moments apart:
 *
 *   - `/api/build/subscription/status` (via lib/ainative/active-plan.ts) read
 *     core's `GET /api/v1/auth/me` → correctly returned `enterprise` for a real
 *     paying customer.
 *   - `getPlanStatus()` in lib/ainative/plan.ts read core's separate
 *     `GET /api/v1/subscription` → returned `hobbyist` for that same customer,
 *     because that endpoint intermittently takes >20s (measured live: 60.1s, vs
 *     /auth/me's 0.09s), blew past ainativeFetch's 20s timeout, and landed in a
 *     bare `catch { tier = 'hobbyist' }`.
 *
 * The result: a real, paying Enterprise founder was told they were on Hobbyist
 * and blocked from a paid capability (ZeroVoice provisioning), with a genuine
 * infrastructure failure made indistinguishable from a genuine entitlement gap.
 *
 * This module is deliberately a LEAF: it takes an access token and imports no
 * next-auth session machinery, so every consumer — session-based routes and
 * token-based library code alike — resolves tier through the same code path
 * against the same endpoint.
 */

const CORE = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'

const ME_TIMEOUT_MS = 15_000

export interface CorePlanIdentity {
  /** Core's own plan id, lowercased ('enterprise', 'business', ...) or null. */
  rawPlan: string | null
  /** Core reports this user as staff (ADMIN / SUPERUSER) ⇒ full access. */
  admin: boolean
  email: string | null
  trialExpiresAt: string | null
  /**
   * Whether this reflects a REAL answer from core, as opposed to a fallback
   * after a timeout/5xx/network error. Callers MUST NOT treat `verified:false`
   * as "genuinely unpaid" — that conflation is the #762 bug.
   */
  verified: boolean
}

const UNKNOWN: CorePlanIdentity = {
  rawPlan: null,
  admin: false,
  email: null,
  trialExpiresAt: null,
  verified: true,
}

/**
 * Read the signed-in user's plan identity from core's `/api/v1/auth/me`.
 * Never throws — an unreachable core yields `verified: false`, logged loudly.
 */
export async function fetchCorePlanIdentity(token: string): Promise<CorePlanIdentity> {
  if (!token) return { ...UNKNOWN }

  try {
    const res = await fetch(`${CORE}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(ME_TIMEOUT_MS),
    })
    if (!res.ok) return unverified(`/api/v1/auth/me returned HTTP ${res.status}`)

    const me = await res.json().catch(() => null)
    const inner = (me?.data || me || {}) as Record<string, any>

    // Staff bypass (#309): admins get full Builder access (⇒ enterprise).
    const role = String(inner.role || me?.role || '').toUpperCase()
    const admin =
      role === 'ADMIN' ||
      role === 'SUPERUSER' ||
      inner.is_superuser === true ||
      inner.is_admin === true

    if (admin) {
      return {
        rawPlan: 'admin',
        admin: true,
        email: inner.email || me?.email || null,
        trialExpiresAt: null,
        verified: true,
      }
    }

    // #309: read the tier from every field core might expose it under.
    const raw = String(
      inner.plan ||
        inner.subscription_tier ||
        inner.tier ||
        inner.subscription?.tier ||
        me?.plan ||
        '',
    ).toLowerCase()

    return {
      rawPlan: raw || null,
      admin: false,
      email: inner.email || me?.email || null,
      trialExpiresAt: inner.trial_expires_at || me?.trial_expires_at || null,
      verified: true,
    }
  } catch (err) {
    return unverified(
      `/api/v1/auth/me request failed — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
    )
  }
}

/**
 * A plan we could NOT verify. Logged LOUDLY on purpose (#762): before this, a
 * core failure was swallowed and rendered identical to "genuinely unpaid" /
 * "genuinely Hobbyist", which is exactly how a paying Enterprise customer got
 * blocked from a paid feature with nothing in the logs to show why.
 */
function unverified(error: string): CorePlanIdentity {
  console.error(
    `[plan] PLAN VERIFICATION FAILED — cannot confirm this user's tier. ` +
      `A PAYING customer may be wrongly denied a paid feature. Cause: ${error}`,
  )
  return { ...UNKNOWN, verified: false }
}
