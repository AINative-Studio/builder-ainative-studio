/**
 * Plan / tier awareness — mirrors core's get_tier_limits so the builder
 * subdomain shows and enforces the SAME AINative subscription rules as
 * ainative.studio. Core is the hard gate (403 on create); this drives the UI
 * (remaining slots, trial state, upgrade prompts) and resolves the user's tier.
 *
 * There is NO "free" tier anymore — Hobbyist ($5, 7-day trial) is the entry
 * tier that replaced it (core #128). New users start on Hobbyist with
 * status="trialing"; legacy plan names (free/basic/starter) still resolve to
 * hobbyist on the way in, but the customer-facing tier is Hobbyist.
 */
import { ainativeFetch } from '@/lib/ainative/client'
import { fetchCorePlanIdentity } from '@/lib/ainative/resolve-plan'
import { listProjects } from '@/lib/ainative/projects'
import { listWorkspaces } from '@/lib/ainative/workspaces'

/** `/api/v1/subscription` is enrichment only (#762) and is measurably slow —
 *  cap it tightly so a 60s core stall can't hold up an entitlement check that
 *  has already been answered authoritatively by `/api/v1/auth/me`. */
const SUBSCRIPTION_DETAIL_TIMEOUT_MS = 8_000

/** The limits core enforces per tier (source: core get_tier_limits, project_router.py).
 *  -1 means unlimited. */
export const TIER_LIMITS: Record<string, { maxWorkspaces: number; maxProjects: number }> = {
  hobbyist: { maxWorkspaces: 1, maxProjects: 3 },
  // Starter $20 (core#6615 / core PR #6617) — between Hobbyist and Pro.
  starter: { maxWorkspaces: 2, maxProjects: 10 },
  pro: { maxWorkspaces: 5, maxProjects: -1 },
  scale: { maxWorkspaces: 50, maxProjects: 50 },
  // Business ($149) — the paid tier between Pro and Enterprise. It was MISSING
  // here (#762), so normalizeTier('business') fell through to 'hobbyist' and
  // every paid-gated route's PAID_PLANS check rejected a real paying Business
  // customer even when core answered perfectly. Same class of silent downgrade
  // as the /api/v1/subscription timeout this issue was filed for.
  business: { maxWorkspaces: 20, maxProjects: -1 },
  enterprise: { maxWorkspaces: -1, maxProjects: -1 },
  // Cody vCTO ($4999) — top tier, everything unlimited.
  cody_vcto: { maxWorkspaces: -1, maxProjects: -1 },
}

/** Human label for a tier key (customer-facing). */
export function tierLabel(tier: string): string {
  const map: Record<string, string> = {
    hobbyist: 'Hobbyist',
    starter: 'Starter',
    pro: 'Pro',
    scale: 'Scale',
    business: 'Business',
    enterprise: 'Enterprise',
    cody_vcto: 'Cody vCTO',
  }
  return map[tier] ?? 'Hobbyist'
}

/** Aliases core's catalog sometimes emits for the same underlying tier. Kept in
 *  sync with the PLAN_MAP in lib/ainative/active-plan.ts + the subscription/status
 *  route, so one plan id can never mean two different things depending on which
 *  code path happens to read it (#762). */
const TIER_ALIASES: Record<string, string> = {
  launch: 'pro',
  company: 'business',
}

/** Normalize a core plan_name to a limits key. Legacy free/basic/trial resolve to
 *  hobbyist (the entry tier that replaced free). "starter" is now the DISTINCT $20
 *  Builder tier (core#6615 / core PR #6617) — no longer aliased to hobbyist, so a
 *  paying Starter gets its own limits + build allowance, matching core.
 *
 *  #762: every PAID core plan id must resolve to itself here. `business` and
 *  `cody_vcto` previously fell through to `hobbyist`, silently denying paid
 *  features to real paying customers — an unknown plan defaults to hobbyist,
 *  which is safe ONLY if every plan we actually sell is listed. */
export function normalizeTier(planName: string | undefined | null): string {
  const k = (planName || '').toLowerCase().trim()
  if (k === 'starter') return 'starter'
  if (['free', 'basic', 'trial', 'free tier', 'hobbyist'].includes(k)) return 'hobbyist'
  if (k in TIER_ALIASES) return TIER_ALIASES[k]
  if (k in TIER_LIMITS) return k
  return 'hobbyist'
}

/**
 * The ONE paid-tier predicate (#762). Four routes (zerovoice, provision,
 * growth/ad-test, growth/ad-budget-checkout) each kept their own copy-pasted
 * `PAID_PLANS` Set, so a plan id added in one place silently stayed unpaid in
 * the others — the same "several code paths answer the same entitlement
 * question differently" defect this issue is about.
 *
 * Accepts BOTH vocabularies on purpose, since callers legitimately hold either:
 *   - normalized limit tiers from getPlanStatus() — pro | business | enterprise | ...
 *   - Builder ActivePlan / core catalog ids from the registry — launch | company | ...
 * Everything is funnelled through normalizeTier first, so the two can never drift.
 */
export function isPaidTier(plan: string | undefined | null): boolean {
  return PAID_TIERS.has(normalizeTier(plan))
}

/** Normalized tiers that unlock real, billed capability. Deliberately the SAME
 *  membership the four duplicated PAID_PLANS sets already had (pro/business/
 *  enterprise/cody_vcto, plus the launch/company aliases normalizeTier folds
 *  into pro/business) — this consolidation fixes WHERE the answer comes from,
 *  not WHICH plans are entitled. `starter` ($20) stays out, exactly as before. */
const PAID_TIERS = new Set(['pro', 'business', 'enterprise', 'cody_vcto'])

export interface PlanStatus {
  tier: string
  tierLabel: string
  /** Subscription status from core: 'trialing' | 'active' | 'none'. */
  status: 'trialing' | 'active' | 'none'
  trial: { active: boolean; endsAt: string | null; daysLeft: number | null }
  workspaces: { used: number; max: number; remaining: number; unlimited: boolean }
  projects: { used: number; max: number; remaining: number; unlimited: boolean }
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const end = Date.parse(iso)
  if (Number.isNaN(end)) return null
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000))
}

/** Fetch the user's current tier, trial state, and usage in one shot.
 *
 * #762 — TIER comes from ONE authoritative source for every caller:
 * `fetchCorePlanIdentity()` (core's `/api/v1/auth/me`), the same source that
 * the customer-facing `/api/build/subscription/status` route and every other
 * paid gate (via lib/ainative/active-plan.ts) already resolve through.
 * It used to come from `/api/v1/subscription`, which intermittently takes
 * >20s (measured live: 60.1s vs /auth/me's 0.09s), blew past ainativeFetch's
 * timeout, and silently demoted real paying customers to `hobbyist` —
 * blocking an Enterprise founder from ZeroVoice provisioning.
 *
 * `/api/v1/subscription` is still read for its richer billing detail
 * (active vs trialing, trial_end) but is now STRICTLY non-authoritative:
 * it can never decide entitlement, and its failure can never downgrade
 * anyone. Every fallback is logged rather than swallowed.
 */
export async function getPlanStatus(accessToken: string): Promise<PlanStatus> {
  // ── Tier: single source of truth, shared with every other paid gate ───────
  const identity = await fetchCorePlanIdentity(accessToken)
  // `rawPlan` is core's own plan id; admins resolve to 'enterprise' (#309).
  // When core could NOT be reached (`verified === false`), rawPlan is null and
  // this lands on the un-paid default — but fetchCorePlanIdentity has already
  // logged that loudly, so the failure is visible rather than silent (#762).
  const tier = identity.admin ? 'enterprise' : normalizeTier(identity.rawPlan)

  // ── Billing/trial detail: enrichment only, never entitlement ──────────────
  // Default to the state implied by the tier we already resolved, so a slow or
  // failing /api/v1/subscription degrades the *detail* without ever touching
  // the *tier*. A resolved paid tier means the account is active.
  let status: PlanStatus['status'] = tier === 'hobbyist' ? 'trialing' : 'active'
  let trialEnd: string | null = identity.trialExpiresAt
  try {
    const sub = await ainativeFetch<any>('/api/v1/subscription', accessToken, {
      timeoutMs: SUBSCRIPTION_DETAIL_TIMEOUT_MS,
    })
    const s = sub?.data?.subscription ?? sub?.subscription ?? sub?.data ?? null
    if (s) {
      const raw = String(s?.status ?? '').toLowerCase()
      status = raw === 'trialing' || raw === 'trial' ? 'trialing' : raw === 'active' ? 'active' : 'none'
      trialEnd = s?.trial_end ?? s?.trial_ends_at ?? trialEnd
      // Cross-check ONLY — core disagreeing with itself is a core bug worth
      // seeing in the logs, but /auth/me stays authoritative either way.
      const subTier = normalizeTier(s?.plan?.id ?? s?.plan?.name ?? s?.plan_name ?? null)
      if (subTier !== tier) {
        console.warn(
          `[plan] core plan sources DISAGREE for this account — ` +
            `/api/v1/auth/me says "${tier}", /api/v1/subscription says "${subTier}". ` +
            `Using "${tier}" (authoritative).`,
        )
      }
    }
  } catch (err) {
    // Detail only — the tier above is unaffected. Logged, never silent (#762).
    console.warn(
      `[plan] /api/v1/subscription detail unavailable (tier "${tier}" already ` +
        `resolved authoritatively from /api/v1/auth/me, unaffected): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const limits = TIER_LIMITS[tier] ?? TIER_LIMITS.hobbyist
  const daysLeft = daysUntil(trialEnd)

  // Current usage — count the user's real workspaces + projects.
  const [workspaces, projects] = await Promise.all([
    listWorkspaces(accessToken).catch(() => []),
    listProjects(accessToken).catch(() => []),
  ])

  const slot = (used: number, max: number) => ({
    used,
    max,
    unlimited: max === -1,
    remaining: max === -1 ? Infinity : Math.max(0, max - used),
  })

  return {
    tier,
    tierLabel: tierLabel(tier),
    status,
    trial: {
      active: status === 'trialing',
      endsAt: trialEnd,
      daysLeft: status === 'trialing' ? daysLeft : null,
    },
    workspaces: slot(workspaces.length, limits.maxWorkspaces),
    projects: slot(projects.length, limits.maxProjects),
  }
}
