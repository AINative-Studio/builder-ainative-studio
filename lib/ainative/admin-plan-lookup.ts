/**
 * Cross-account plan lookup by EMAIL (#841) — the one place Builder can ask
 * "is this account paid?" WITHOUT holding that account's own bearer token.
 *
 * WHY THIS EXISTS
 * Every other plan path in Builder (lib/ainative/resolve-plan.ts →
 * `GET /api/v1/auth/me`) is deliberately self-scoped: it takes the signed-in
 * user's access token and answers only for that user. That is correct for
 * request-time gating, but it makes an OFFLINE sweep impossible — a backfill
 * job iterating the company registry has no founder session to borrow, so it
 * could never answer "was this company's owner actually paying?".
 *
 * `GET /api/v1/admin/users?email=<email>` closes that gap: it is admin-scoped
 * (Builder's own shared service key resolves as an ADMIN principal on core) and
 * returns core's OWN `plan` field per user — the same field `/auth/me` reports,
 * read from the same source of truth, just addressed by email instead of by
 * session. Verified live against core (#841): a real paying founder came back
 * `{"email":"…","plan":"pro"}`, a free account came back `plan:"free"`, and an
 * address that does not exist came back `total: 0`.
 *
 * SAFETY PROPERTIES THIS MODULE GUARANTEES
 *  1. EXACT-MATCH ONLY. Core's `email` query is a SUBSTRING filter — asking for
 *     "amador" also returns "amador@selfpreneur.com". A sweep that trusted the
 *     first row of a fuzzy match could attribute one founder's paid plan to a
 *     DIFFERENT account and enroll the wrong company. We therefore re-filter
 *     the response for a case-insensitive EXACT email equality and demand
 *     exactly one survivor; anything else is `verified:false`, never a guess.
 *  2. FAIL CLOSED, AND DISTINGUISHABLY. A timeout, 5xx, auth failure or
 *     ambiguous match yields `{ plan: null, verified: false }` — deliberately
 *     NOT the same shape as a confirmed free account
 *     (`{ plan: 'free', verified: true }`). This is the #762 lesson applied
 *     here: callers must never read "we could not check" as "not paid". For a
 *     sweep that fires real, billable work, conflating the two is the
 *     difference between skipping a company and silently never fixing it.
 *
 * This module is a LEAF on purpose (no next-auth import, no session machinery)
 * so a cron route, a CLI script and a test can all drive it identically.
 */

import { getAinativeApiKey } from '@/lib/build/env-keys'

const CORE = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'

/** Core's admin user listing is a real network call against a large table. */
const LOOKUP_TIMEOUT_MS = 20_000

export interface AdminPlanLookup {
  /** Core's own plan id for this email, lowercased ('pro', 'free', …), or null. */
  plan: string | null
  /** The email core actually matched (echoed back), for audit logging. */
  email: string | null
  /**
   * Whether `plan` reflects a REAL, unambiguous answer from core. False means
   * "could not determine" — a transport failure, a non-200, or an ambiguous /
   * missing match. NEVER treat `verified:false` as "this account is unpaid".
   */
  verified: boolean
  /** Machine-readable cause when `verified` is false — surfaced in sweep logs. */
  reason?: string
}

const UNVERIFIED = (reason: string): AdminPlanLookup => ({
  plan: null,
  email: null,
  verified: false,
  reason,
})

interface AdminUserRow {
  email?: string
  plan?: string
  is_active?: boolean
}

/**
 * Look up a single account's core plan by email, using Builder's admin-scoped
 * service key. Never throws — every failure path returns `verified:false` with
 * a reason, so a sweep can log it and move on rather than crash mid-run.
 */
export async function fetchPlanByEmail(email: string): Promise<AdminPlanLookup> {
  const target = (email || '').trim().toLowerCase()
  if (!target || !target.includes('@')) return UNVERIFIED('invalid_email')

  const key = getAinativeApiKey()
  if (!key) return UNVERIFIED('no_api_key')

  let payload: { users?: AdminUserRow[] } | null = null
  try {
    const res = await fetch(
      `${CORE}/api/v1/admin/users?email=${encodeURIComponent(target)}&limit=50`,
      {
        headers: { Authorization: `Bearer ${key}`, 'X-API-Key': key },
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      },
    )
    if (!res.ok) return UNVERIFIED(`http_${res.status}`)
    payload = await res.json().catch(() => null)
  } catch (err) {
    return UNVERIFIED(
      `request_failed:${err instanceof Error ? err.name : 'unknown'}`,
    )
  }

  const users = Array.isArray(payload?.users) ? payload!.users! : null
  if (!users) return UNVERIFIED('malformed_response')

  // Substring → exact. See SAFETY property 1 above: core matches substrings, so
  // the raw first row may belong to a completely different founder.
  const exact = users.filter(
    (u) => String(u?.email || '').trim().toLowerCase() === target,
  )
  if (exact.length === 0) return UNVERIFIED('no_matching_user')
  if (exact.length > 1) return UNVERIFIED('ambiguous_match')

  const raw = String(exact[0]?.plan || '').trim().toLowerCase()
  if (!raw) return UNVERIFIED('no_plan_field')

  return { plan: raw, email: exact[0]?.email || target, verified: true }
}
