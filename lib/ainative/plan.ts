/**
 * Plan / tier awareness — mirrors core's get_tier_limits so the builder
 * subdomain shows and enforces the SAME AINative subscription rules as
 * ainative.studio. Core is the hard gate (403 on create); this drives the UI
 * (remaining slots, upgrade prompts) and resolves the user's real tier.
 */
import { ainativeFetch } from '@/lib/ainative/client'
import { listProjects } from '@/lib/ainative/projects'
import { listWorkspaces } from '@/lib/ainative/workspaces'

/** The limits core enforces per tier (source: core get_tier_limits, project_router.py).
 *  -1 means unlimited. Free/basic/starter/trial all resolve to hobbyist. */
export const TIER_LIMITS: Record<string, { maxWorkspaces: number; maxProjects: number }> = {
  hobbyist: { maxWorkspaces: 1, maxProjects: 3 },
  free: { maxWorkspaces: 1, maxProjects: 3 },
  pro: { maxWorkspaces: 5, maxProjects: -1 },
  scale: { maxWorkspaces: 50, maxProjects: 50 },
  enterprise: { maxWorkspaces: -1, maxProjects: -1 },
}

/** Normalize a core plan_name to a limits key (legacy free/basic/starter → hobbyist). */
export function normalizeTier(planName: string | undefined | null): string {
  const k = (planName || '').toLowerCase().trim()
  if (['free', 'basic', 'starter', 'trial', 'free tier', 'hobbyist'].includes(k)) return 'hobbyist'
  if (k in TIER_LIMITS) return k
  return 'hobbyist'
}

export interface PlanStatus {
  tier: string
  workspaces: { used: number; max: number; remaining: number; unlimited: boolean }
  projects: { used: number; max: number; remaining: number; unlimited: boolean }
}

/** Fetch the user's current tier + usage in one shot. */
export async function getPlanStatus(accessToken: string): Promise<PlanStatus> {
  // Resolve tier from the subscription endpoint; fall back to hobbyist (the
  // free/default tier) if it's missing so we never over-grant.
  let tier = 'hobbyist'
  try {
    const sub = await ainativeFetch<any>('/api/v1/subscription', accessToken)
    const planName = sub?.data?.plan_name ?? sub?.plan_name ?? sub?.data?.plan ?? null
    tier = normalizeTier(planName)
  } catch {
    tier = 'hobbyist'
  }

  const limits = TIER_LIMITS[tier] ?? TIER_LIMITS.hobbyist

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
    workspaces: slot(workspaces.length, limits.maxWorkspaces),
    projects: slot(projects.length, limits.maxProjects),
  }
}
