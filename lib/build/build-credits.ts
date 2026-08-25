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
  limit: number        // -1 = unlimited
  remaining: number    // Infinity when unlimited
  allowed: boolean     // may this owner start another build?
  unlimited: boolean
}

/** Count how many builds this owner has recorded (best-effort; 0 on any error). */
async function countBuilds(ownerEmail: string): Promise<number> {
  if (!configured() || !ownerEmail) return 0
  try {
    const res = await fetch(rowsUrl(), {
      method: 'GET',
      headers: headers(),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return 0
    const data = await res.json().catch(() => null)
    const rows: Array<{ row_data?: { ownerEmail?: string; event?: string } }> =
      data?.rows || data?.data || []
    return rows.filter(
      (r) => r?.row_data?.ownerEmail === ownerEmail && r?.row_data?.event === 'build',
    ).length
  } catch {
    return 0
  }
}

/**
 * Resolve the owner's build-credit status for a tier. FAILS OPEN (allowed:true)
 * when ZeroDB is unconfigured or on any error — metering must never hard-block.
 */
export async function getBuildCreditStatus(
  ownerEmail: string,
  tier: string,
): Promise<BuildCreditStatus> {
  const limit = buildLimitForTier(tier)
  if (limit < 0) {
    return { used: 0, limit: -1, remaining: Infinity, allowed: true, unlimited: true }
  }
  // Unconfigured metering → fail open (don't block on infra we can't reach).
  if (!configured() || !ownerEmail) {
    return { used: 0, limit, remaining: limit, allowed: true, unlimited: false }
  }
  const used = await countBuilds(ownerEmail)
  const remaining = Math.max(0, limit - used)
  return { used, limit, remaining, allowed: remaining > 0, unlimited: false }
}

/**
 * Record that this owner started a build (append-only). Best-effort — a failed
 * write never blocks the build (we'd rather under-count than dead-end a founder).
 * Returns true if the row was written.
 */
export async function recordBuild(ownerEmail: string, slug?: string): Promise<boolean> {
  if (!configured() || !ownerEmail) return false
  try {
    const res = await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        row_data: {
          ownerEmail,
          event: 'build',
          slug: slug || '',
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
