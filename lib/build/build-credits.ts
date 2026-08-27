/**
 * Build credits (#dashboard-ux — freemium enforcement).
 *
 * A "build" = one idea→clickable-prototype run. The freemium ladder:
 *   - Free (internal tier "hobbyist", the no-card entry): FREE_BUILD_LIMIT builds.
 *   - Starter ($20): STARTER_BUILD_LIMIT builds/mo (~1000 requests ≈ ~80 builds).
 *   - Pro / Business / Enterprise: unlimited builds (metered by token allotment).
 *
 * Counts are persisted per-owner in a ZeroDB table (append-only, latest-wins on
 * read), mirroring lib/build/app-registry.ts. When ZeroDB is unconfigured we
 * FAIL OPEN (allow the build) — a metering outage must never block a paying or
 * trialing founder from building; we'd rather under-count than dead-end.
 *
 * The counter is keyed by the AINative account email (owner identity). Anonymous
 * visitors can't reach a build anymore (the auth wall forces registration first),
 * so every counted build has an owner.
 */

import { computeTotalEcosystemBonus } from '@/lib/build/ecosystem-bonus'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY || ''
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const TABLE = 'builder_build_credits'

/** Free (no-card) tier gets this many idea→prototype builds before an upgrade wall. */
export const FREE_BUILD_LIMIT = 3
/** Starter ($20) — ~1000 Haiku requests ≈ this many full builds/month. */
export const STARTER_BUILD_LIMIT = 80

function rowsUrl(): string {
  return `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${TABLE}/rows`
}
function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}
function configured(): boolean {
  return Boolean(API_KEY && PROJECT_ID)
}

/**
 * Per-tier build allowance. -1 = unlimited. Unknown tiers → free allowance (never
 * over-grant).
 *
 * NOTE (core#6615, RESOLVED by core PR #6617): 'starter' is now a DISTINCT paid
 * tier end-to-end. Core splits it from Hobbyist across the billing stack and
 * /subscription returns plan.id='starter', which Builder's normalizeTier maps to
 * 'starter' (not hobbyist) — so a paid Starter correctly gets STARTER_BUILD_LIMIT.
 */
export function buildLimitForTier(tier: string): number {
  switch (tier) {
    case 'pro':
    case 'scale':
    case 'business':
    case 'enterprise':
      return -1 // unlimited (token-metered instead)
    case 'starter':
      return STARTER_BUILD_LIMIT
    case 'hobbyist':
    default:
      return FREE_BUILD_LIMIT
  }
}

export interface BuildCreditStatus {
  used: number
  limit: number        // EFFECTIVE limit (baseLimit + ecosystemBonus); -1 = unlimited
  baseLimit: number    // the tier's base allowance before any ecosystem bonus
  ecosystemBonus: number // extra builds earned by composing AINative primitives (#324 GR-15)
  remaining: number    // Infinity when unlimited
  allowed: boolean     // may this owner start another build?
  unlimited: boolean
  /**
   * Value guarantee (#310/#311 GR-01/GR-02): true when this status was allowed
   * ONLY because the owner has never reached a working preview. The free tier
   * guarantees one VISIBLE build — credits are recorded at build START, so a
   * founder whose builds all failed/were abandoned before rendering must not
   * hit a card wall having never seen value.
   */
  valueGuarantee?: boolean
}

/**
 * Apply the value guarantee (#310/#311) to a resolved credit status. PURE —
 * fully unit-covered. If the owner is out of credits but has NEVER reached a
 * working preview, the build is allowed anyway (flagged valueGuarantee) so the
 * first visible build always happens before any paywall. An owner who HAS seen
 * a preview keeps the normal limit.
 */
export function applyValueGuarantee(
  status: BuildCreditStatus,
  everReachedPreview: boolean,
): BuildCreditStatus {
  if (status.allowed) return status
  if (everReachedPreview) return status
  return { ...status, allowed: true, valueGuarantee: true }
}

/**
 * Read this owner's recorded builds: how many, plus the total ecosystem-runway
 * bonus earned from the primitives each build composed (#324 GR-15). The bonus
 * is recomputed from the persisted per-build primitives lists (not a stored
 * number) so it stays deterministic under constant changes. Best-effort;
 * zeros on any error (fail open elsewhere).
 */
async function readOwnerBuilds(ownerEmail: string): Promise<{ used: number; bonus: number }> {
  if (!configured() || !ownerEmail) return { used: 0, bonus: 0 }
  try {
    const res = await fetch(rowsUrl(), {
      method: 'GET',
      headers: headers(),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return { used: 0, bonus: 0 }
    const data = await res.json().catch(() => null)
    const rows: Array<{ row_data?: { ownerEmail?: string; event?: string; primitives?: string[] } }> =
      data?.rows || data?.data || []
    const mine = rows.filter(
      (r) => r?.row_data?.ownerEmail === ownerEmail && r?.row_data?.event === 'build',
    )
    const bonus = computeTotalEcosystemBonus(
      mine.map((r) => (Array.isArray(r?.row_data?.primitives) ? r.row_data!.primitives! : [])),
    )
    return { used: mine.length, bonus }
  } catch {
    return { used: 0, bonus: 0 }
  }
}

/**
 * Resolve the owner's build-credit status for a tier. FAILS OPEN (allowed:true)
 * when ZeroDB is unconfigured or on any error — metering must never hard-block.
 *
 * #324 GR-15: the EFFECTIVE limit is baseLimit + the ecosystem-runway bonus the
 * owner earned by composing AINative primitives in past builds — so the 402
 * threshold in the credits route automatically accounts for it.
 */
export async function getBuildCreditStatus(
  ownerEmail: string,
  tier: string,
): Promise<BuildCreditStatus> {
  const baseLimit = buildLimitForTier(tier)
  if (baseLimit < 0) {
    return {
      used: 0, limit: -1, baseLimit: -1, ecosystemBonus: 0,
      remaining: Infinity, allowed: true, unlimited: true,
    }
  }
  // Unconfigured metering → fail open (don't block on infra we can't reach).
  if (!configured() || !ownerEmail) {
    return {
      used: 0, limit: baseLimit, baseLimit, ecosystemBonus: 0,
      remaining: baseLimit, allowed: true, unlimited: false,
    }
  }
  const { used, bonus } = await readOwnerBuilds(ownerEmail)
  const limit = baseLimit + bonus
  const remaining = Math.max(0, limit - used)
  return {
    used, limit, baseLimit, ecosystemBonus: bonus,
    remaining, allowed: remaining > 0, unlimited: false,
  }
}

/**
 * Record that this owner started a build (append-only). Best-effort — a failed
 * write never blocks the build (we'd rather under-count than dead-end a founder).
 * Returns true if the row was written.
 *
 * `primitives` (#324 GR-15) is the SERVER-computed list of AINative primitives
 * this build composes (from selectPrimitives(idea, track) in the credits route).
 * It's persisted with the row so future status reads can deterministically
 * recompute the ecosystem-runway bonus.
 */
export async function recordBuild(
  ownerEmail: string,
  slug?: string,
  primitives?: string[],
): Promise<boolean> {
  return appendEvent(ownerEmail, 'build', slug, primitives)
}

/**
 * Record the VALUE MOMENT (#310/#311): this owner's build reached a working,
 * rendered preview. Drives the value guarantee — once at least one of these
 * exists, the normal build limit applies; until then a founder is never walled
 * off before seeing their app work. Best-effort, append-only.
 */
export async function recordPreviewReached(ownerEmail: string, slug?: string): Promise<boolean> {
  return appendEvent(ownerEmail, 'preview_reached', slug)
}

/**
 * Has this owner EVER had a build reach a working preview? Fails toward false
 * on any error — which fails the gate OPEN (the value guarantee allows the
 * build), consistent with "metering must never hard-block".
 */
export async function hasReachedPreview(ownerEmail: string): Promise<boolean> {
  if (!configured() || !ownerEmail) return false
  try {
    const res = await fetch(rowsUrl(), {
      method: 'GET',
      headers: headers(),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return false
    const data = await res.json().catch(() => null)
    const rows: Array<{ row_data?: { ownerEmail?: string; event?: string } }> =
      data?.rows || data?.data || []
    return rows.some(
      (r) => r?.row_data?.ownerEmail === ownerEmail && r?.row_data?.event === 'preview_reached',
    )
  } catch {
    return false
  }
}

async function appendEvent(
  ownerEmail: string,
  event: string,
  slug?: string,
  primitives?: string[],
): Promise<boolean> {
  if (!configured() || !ownerEmail) return false
  try {
    const res = await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        row_data: {
          ownerEmail,
          event,
          slug: slug || '',
          primitives: Array.isArray(primitives) ? primitives : [],
          createdAt: new Date().toISOString(),
        },
      }),
      signal: AbortSignal.timeout(12000),
    })
    return res.ok
  } catch {
    return false
  }
}
