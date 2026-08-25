/**
 * Refer & Earn — referral/growth program (#59). Modeled on Polsia's mechanics:
 * cash credits on a referred user's SUBSCRIBE (not on signup), UNCAPPED, credited
 * instantly on conversion, with per-referrer stats (Friends Referred / Credits
 * Earned / Credits Pending).
 *
 * WHY: Builder had no referral loop at all (verified: no referral code anywhere in
 * app/lib/components before this). Polsia's account menu ships a Refer & Earn view;
 * this is the growth lever for the campaign push. We back it with our OWN primitive
 * — a ZeroDB `build_referrals` table — so it's durable and owned, mirroring the
 * chat-store / task-store / document-store pattern already on main.
 *
 * DATA MODEL — one ledger row per (referrer → referred) attribution:
 *   - referrerKey:  the durable owner key of the person who shared the link
 *                   (the authed user's email; reuses deriveOwnerKey so identity
 *                   ties to real auth #49). This is the code owner.
 *   - code:         the referrer's stable public referral code (derived from
 *                   referrerKey — same input always yields the same code).
 *   - referredKey:  the durable owner key of the person who signed up via the link.
 *   - status:       'pending' at signup-attribution → 'credited' when the referred
 *                   user subscribes (the reward moment).
 *   - creditsAward: the cash credit ($) awarded to the referrer on conversion.
 *   - plan:         the plan the referred user subscribed to (recorded at credit).
 *
 * Stats are DERIVED from this ledger (never a separately-mutated counter that can
 * drift): friendsReferred = rows, creditsEarned = Σ credited, creditsPending =
 * count pending. UNCAPPED by design (no max on rows or on Σ credits).
 *
 * ATTRIBUTION reuses the existing conversion/attribution pattern (attribution.ts /
 * conversions.ts): the referral code is captured at landing into a first-party
 * cookie (`ax_ref`), exactly like `ax_gclid`, and read server-side at signup. A
 * self-referral (referredKey === referrerKey) is rejected so a user can't farm
 * their own credits.
 *
 * The heavy I/O (ZeroDB) is isolated from the pure logic (code gen, link build,
 * stats, self-referral guard, cookie read) so the pure core is unit-testable
 * without a network — same split as task-store.
 */

import { deriveOwnerKey } from '@/lib/build/chat-store'

const ZERODB_API = process.env.ZERODB_API_URL || 'https://api.ainative.studio/api'
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
const TABLE_NAME = 'build_referrals'

/** The cash credit ($) a referrer earns each time a referred user subscribes. */
export const REFERRAL_CREDIT_AWARD = 25

/** Cookie the referral code is persisted in at landing (mirrors ax_gclid). */
export const REFERRAL_COOKIE = 'ax_ref'

/** How long a captured referral code survives (matches the ad-click window). */
export const REFERRAL_COOKIE_MAX_AGE = 90 * 24 * 60 * 60 // 90 days

/** Lifecycle status of a single referral attribution. */
export type ReferralStatus = 'pending' | 'credited'

/** A single persisted referral attribution (one referrer → one referred user). */
export interface ReferralRecord {
  /** Durable owner key of the referrer (the code owner). */
  referrerKey: string
  /** The referrer's stable public code. */
  code: string
  /** Durable owner key of the referred user who signed up via the link. */
  referredKey: string
  /** 'pending' until the referred user subscribes, then 'credited'. */
  status: ReferralStatus
  /** Cash credit ($) awarded to the referrer once credited (0 while pending). */
  creditsAward: number
  /** Plan the referred user subscribed to (empty while pending). */
  plan: string
  /** ISO timestamp the attribution was created (signup). */
  createdAt: string
  /** ISO timestamp last updated (credited). */
  updatedAt: string
}

/** Aggregated per-referrer stats surfaced in the Refer & Earn view. */
export interface ReferralStats {
  /** Total friends who signed up via this user's link (all statuses). Uncapped. */
  friendsReferred: number
  /** Total cash credits ($) earned from credited conversions. Uncapped. */
  creditsEarned: number
  /** Number of referrals still pending (signed up, not yet subscribed). */
  creditsPending: number
}

/** Hard cap on rows a single load returns (defends payload size, not the reward). */
export const MAX_LOAD_REFERRALS = 500

function getApiKey(): string {
  return process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || process.env.API_Key || ''
}

// ---------------------------------------------------------------------------
// PURE LOGIC (no I/O) — unit-testable directly
// ---------------------------------------------------------------------------

/**
 * Derive a stable, public, URL-safe referral CODE from a durable owner key.
 * Deterministic: the same owner key always yields the same code, so a user's
 * link never changes and can be shared/printed. Uses a small FNV-1a hash folded
 * to base36 and upper-cased, prefixed so it reads as a referral code. Pure.
 *
 * NOT reversible and NOT secret — it only needs to be stable + collision-light,
 * and it must never leak the underlying email (so we hash, not encode).
 */
export function referralCodeFor(ownerKey: string): string {
  const key = String(ownerKey || '').trim().toLowerCase()
  if (!key) return ''
  // FNV-1a 32-bit over the key.
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // Second pass with a different seed to widen the space (reduce collisions).
  let g = 0x9dc5811c
  for (let i = key.length - 1; i >= 0; i--) {
    g ^= key.charCodeAt(i)
    g = Math.imul(g, 0x01000193)
  }
  const a = (h >>> 0).toString(36)
  const b = (g >>> 0).toString(36)
  return `REF${(a + b).toUpperCase()}`.slice(0, 16)
}

/**
 * Resolve a referral code directly from a session, via the durable owner key.
 * Returns '' for a guest/anonymous session (a guest has no shareable identity,
 * so no stable public code). Pure.
 */
export function referralCodeForSession(
  session: Parameters<typeof deriveOwnerKey>[0],
): string {
  const key = deriveOwnerKey(session)
  // Guests get an unstable/anonymous key; don't mint a shareable code for them.
  if (!key || key.startsWith('guest:')) return ''
  return referralCodeFor(key)
}

/** Normalize a raw referral code (trim, upper-case, strip junk). Pure. */
export function normalizeCode(raw: unknown): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 16)
}

/** True when `code` looks like a well-formed referral code. Pure. */
export function isValidCode(code: unknown): boolean {
  const c = normalizeCode(code)
  return c.startsWith('REF') && c.length >= 6
}

/**
 * Build the shareable referral LINK for a code, against a base origin. The code is
 * carried as `?ref=` so the landing page can capture it exactly like `?gclid=`.
 * Returns '' for an empty code. Pure.
 */
export function referralLink(code: string, origin: string): string {
  const c = normalizeCode(code)
  if (!c) return ''
  const base = String(origin || '').replace(/\/+$/, '') || 'https://ainative.studio'
  return `${base}/?ref=${encodeURIComponent(c)}`
}

/**
 * Is this attribution a self-referral? A user must not earn credit for referring
 * themselves. Compares the durable owner keys, case-insensitively. Pure — so the
 * guard is unit-testable and enforced identically in the route and the store.
 */
export function isSelfReferral(referrerKey: string, referredKey: string): boolean {
  const a = String(referrerKey || '').trim().toLowerCase()
  const b = String(referredKey || '').trim().toLowerCase()
  return !!a && a === b
}

/**
 * Coerce a raw ZeroDB row (or partial input) into a valid ReferralRecord, filling
 * defaults and normalizing the status/award. Returns null when the row lacks the
 * required keys (so garbage rows are dropped). Pure.
 */
export function coerceReferral(raw: any): ReferralRecord | null {
  const rd = raw?.row_data || raw
  if (!rd) return null
  const referrerKey = String(rd.referrer_key || rd.referrerKey || '').trim().toLowerCase()
  const referredKey = String(rd.referred_key || rd.referredKey || '').trim().toLowerCase()
  if (!referrerKey || !referredKey) return null
  const status: ReferralStatus = rd.status === 'credited' ? 'credited' : 'pending'
  const createdAt = String(rd.created_at || rd.createdAt || new Date().toISOString())
  const awardNum = Number(rd.credits_award ?? rd.creditsAward ?? 0)
  return {
    referrerKey,
    code: normalizeCode(rd.code) || referralCodeFor(referrerKey),
    referredKey,
    status,
    creditsAward: status === 'credited' ? (Number.isFinite(awardNum) ? awardNum : 0) : 0,
    plan: String(rd.plan || ''),
    createdAt,
    updatedAt: String(rd.updated_at || rd.updatedAt || createdAt),
  }
}

/**
 * Compute per-referrer stats from a ledger of referral rows. DERIVED, never a
 * standalone counter — so the numbers can't drift from the source of truth.
 * UNCAPPED: no ceiling on friendsReferred or creditsEarned. Pure.
 */
export function computeStats(rows: ReferralRecord[]): ReferralStats {
  const list = Array.isArray(rows) ? rows : []
  let creditsEarned = 0
  let creditsPending = 0
  for (const r of list) {
    if (!r) continue
    if (r.status === 'credited') creditsEarned += Number(r.creditsAward) || 0
    else creditsPending += 1
  }
  return { friendsReferred: list.length, creditsEarned, creditsPending }
}

/**
 * Read the persisted referral code from a request's cookies (server-side), the
 * same way conversions.ts reads `ax_gclid`. Returns '' when absent/invalid. Pure.
 */
export function refCodeFromRequest(request: Request): string {
  const cookie = request.headers.get('cookie') || ''
  const m = cookie.match(/(?:^|; )ax_ref=([^;]*)/)
  if (!m) return ''
  const code = normalizeCode(decodeURIComponent(m[1]))
  return isValidCode(code) ? code : ''
}

// ---------------------------------------------------------------------------
// ZeroDB I/O — isolated from the pure logic above
// ---------------------------------------------------------------------------

async function zerodbRequest(
  method: string,
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<any> {
  const url = `${ZERODB_API}${path}`
  const timeoutMs = opts.timeoutMs ?? 12_000
  const retries = opts.retries ?? 0
  let lastErr: unknown = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'X-API-Key': getApiKey(), 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) {
        if (attempt < retries && (res.status === 401 || res.status === 429 || res.status >= 500)) continue
        return null
      }
      return await res.json()
    } catch (e) {
      lastErr = e
    }
  }
  if (lastErr) throw lastErr
  return null
}

/**
 * List all referral rows OWNED by a referrer key (for that user's stats view).
 * Returns [] on empty/failure — an honest empty state, never fabricated.
 */
export async function listReferralsByReferrer(referrerKey: string): Promise<ReferralRecord[]> {
  const key = String(referrerKey || '').trim().toLowerCase()
  if (!key) return []
  try {
    const result = await zerodbRequest(
      'POST',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/query`,
      { filters: { referrer_key: key }, limit: MAX_LOAD_REFERRALS },
      { retries: 1 },
    )
    const rows: any[] = result?.data || []
    return rows
      .map((r) => coerceReferral(r))
      .filter((r): r is ReferralRecord => r !== null)
  } catch (e) {
    console.warn('[referral] listReferralsByReferrer failed:', (e as Error)?.name || e)
    return []
  }
}

/** Load a single referral row by the referred user's key (0/1 expected). */
export async function findReferralByReferred(referredKey: string): Promise<ReferralRecord | null> {
  const key = String(referredKey || '').trim().toLowerCase()
  if (!key) return null
  try {
    const result = await zerodbRequest(
      'POST',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/query`,
      { filters: { referred_key: key }, limit: 1 },
      { retries: 1 },
    )
    const rows: any[] = result?.data || []
    return rows.length ? coerceReferral(rows[0]) : null
  } catch (e) {
    console.warn('[referral] findReferralByReferred failed:', (e as Error)?.name || e)
    return null
  }
}

/**
 * Resolve a referrer's OWN code + link + stats for the Refer & Earn view. Best
 * effort: on any failure returns the code/link (pure, always works) with zeroed
 * stats, so the view still renders the shareable link.
 */
export async function getReferralSummary(
  session: Parameters<typeof deriveOwnerKey>[0],
  origin: string,
): Promise<{ code: string; link: string; stats: ReferralStats }> {
  const code = referralCodeForSession(session)
  const link = referralLink(code, origin)
  if (!code) return { code: '', link: '', stats: { friendsReferred: 0, creditsEarned: 0, creditsPending: 0 } }
  const referrerKey = deriveOwnerKey(session)
  const rows = await listReferralsByReferrer(referrerKey).catch(() => [])
  return { code, link, stats: computeStats(rows) }
}

/**
 * Attribute a referred SIGNUP to a referral code. Best-effort: returns the created
 * (pending) ReferralRecord on success, null otherwise (never throws). Guards:
 *  - invalid code → null (nothing to attribute).
 *  - self-referral (referred === code owner) → null (can't farm own credits).
 *  - already-attributed referred user → returns the existing row (idempotent; a
 *    user is attributed to at most one referrer, first link wins).
 *
 * NOTE the code alone identifies the referrer publicly; we store the code and the
 * referred key. The referrer's own rows are found by their derived code at
 * credit time, so we also persist the referrer key when resolvable from the code.
 */
export async function attributeSignup(
  code: string,
  referredKey: string,
  referrerKey?: string,
): Promise<ReferralRecord | null> {
  const c = normalizeCode(code)
  const rk = String(referredKey || '').trim().toLowerCase()
  if (!isValidCode(c) || !rk) return null
  // The referrer key: if the caller resolved it (referred==referrer guard needs
  // the real key), use it; otherwise we can't compare, so store the code only.
  const owner = String(referrerKey || '').trim().toLowerCase()
  if (owner && isSelfReferral(owner, rk)) return null
  // Idempotent: a referred user is attributed once.
  const existing = await findReferralByReferred(rk).catch(() => null)
  if (existing) return existing

  const now = new Date().toISOString()
  const row = {
    referrer_key: owner || `code:${c}`,
    code: c,
    referred_key: rk,
    status: 'pending' as ReferralStatus,
    credits_award: 0,
    plan: '',
    created_at: now,
    updated_at: now,
  }
  try {
    const result = await zerodbRequest(
      'POST',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/rows`,
      { row_data: row },
    )
    if (!result) return null
    return coerceReferral(row)
  } catch (e) {
    console.warn('[referral] attributeSignup failed:', (e as Error)?.name || e)
    return null
  }
}

/**
 * Credit the referrer when a referred user SUBSCRIBES (the reward moment, #59).
 * Looks up the pending referral for `referredKey`, flips it to 'credited', and
 * awards REFERRAL_CREDIT_AWARD (uncapped — every conversion pays). Best-effort:
 * returns the credit amount on success, 0 when there's nothing to credit or on
 * failure. NEVER throws — it's called from the checkout-verify path and must not
 * break checkout confirmation.
 *
 * Idempotent: an already-credited referral is not re-credited (returns 0), so a
 * re-run of subscription/verify can't double-pay.
 */
export async function creditReferrerOnSubscribe(
  referredKey: string,
  plan: string,
): Promise<number> {
  const rk = String(referredKey || '').trim().toLowerCase()
  if (!rk) return 0
  const existing = await findReferralByReferred(rk).catch(() => null)
  if (!existing) return 0 // this subscriber wasn't referred → nothing to credit
  if (existing.status === 'credited') return 0 // already paid → idempotent no-op
  const now = new Date().toISOString()
  try {
    const result = await zerodbRequest(
      'PUT',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/rows`,
      {
        filters: { referred_key: rk },
        row_data: {
          status: 'credited',
          credits_award: REFERRAL_CREDIT_AWARD,
          plan: String(plan || ''),
          updated_at: now,
        },
      },
      { retries: 1 },
    )
    if (!result) return 0
    return REFERRAL_CREDIT_AWARD
  } catch (e) {
    console.warn('[referral] creditReferrerOnSubscribe failed:', (e as Error)?.name || e)
    return 0
  }
}
