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
import { listProjects } from '@/lib/ainative/projects'
import { listWorkspaces } from '@/lib/ainative/workspaces'

/** The limits core enforces per tier (source: core get_tier_limits, project_router.py).
 *  -1 means unlimited. */
export const TIER_LIMITS: Record<string, { maxWorkspaces: number; maxProjects: number }> = {
  hobbyist: { maxWorkspaces: 1, maxProjects: 3 },
  pro: { maxWorkspaces: 5, maxProjects: -1 },
  scale: { maxWorkspaces: 50, maxProjects: 50 },
  enterprise: { maxWorkspaces: -1, maxProjects: -1 },
}

/** Human label for a tier key (customer-facing). */
export function tierLabel(tier: string): string {
  const map: Record<string, string> = {
    hobbyist: 'Hobbyist',
    pro: 'Pro',
    scale: 'Scale',
    enterprise: 'Enterprise',
  }
  return map[tier] ?? 'Hobbyist'
}

/** Normalize a core plan_name to a limits key. Legacy free/basic/starter/trial
 *  all resolve to hobbyist (the entry tier that replaced free). */
export function normalizeTier(planName: string | undefined | null): string {
  const k = (planName || '').toLowerCase().trim()
  if (['free', 'basic', 'starter', 'trial', 'free tier', 'hobbyist'].includes(k)) return 'hobbyist'
  if (k in TIER_LIMITS) return k
  return 'hobbyist'
}

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

/** Fetch the user's current tier, trial state, and usage in one shot. */
export async function getPlanStatus(accessToken: string): Promise<PlanStatus> {
  // Resolve tier + trial from the subscription endpoint. Core returns
  // { data: { subscription: { status, trial_end, plan: { id: <plan_name> } } } }.
  // Fall back to a trialing Hobbyist (the entry default) so we never over-grant.
  let tier = 'hobbyist'
  let status: PlanStatus['status'] = 'trialing'
  let trialEnd: string | null = null
  try {
    const sub = await ainativeFetch<any>('/api/v1/subscription', accessToken)
    const s = sub?.data?.subscription ?? sub?.subscription ?? sub?.data ?? null
    if (s) {
      tier = normalizeTier(s?.plan?.id ?? s?.plan?.name ?? s?.plan_name ?? null)
      const raw = String(s?.status ?? '').toLowerCase()
      status = raw === 'trialing' || raw === 'trial' ? 'trialing' : raw === 'active' ? 'active' : 'none'
      trialEnd = s?.trial_end ?? s?.trial_ends_at ?? null
    } else {
      status = 'none'
    }
  } catch {
    tier = 'hobbyist'
    status = 'trialing'
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
