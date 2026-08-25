/**
 * Live vs Planned/Simulated state logic (#67).
 *
 * Pure utility — no imports, no side effects, fully testable.
 * Determines whether a system or artifact is REAL (live, running) or
 * SIMULATED (planned, will be built on upgrade). Used by the systems grid,
 * plan surface, and Live dashboard to display unambiguous status badges.
 */

/**
 * The two definitive states a system or artifact can be in:
 *  - 'live'    → real, running, backed by a provisioned data source.
 *  - 'planned' → simulated, planned, will be built when the company goes live.
 */
export type SystemStatus = 'live' | 'planned'

/**
 * Badge display config for a given status — drives both the CSS class modifier
 * and the human-readable label that appears next to the dot.
 */
export interface StatusBadgeConfig {
  status: SystemStatus
  /** CSS class modifier appended to `.st` (e.g. 'is-done', 'is-running') */
  modifier: 'is-done' | 'is-running'
  /** Short label shown in the badge */
  label: string
  /** Long tooltip / aria-label for accessibility */
  description: string
}

/** Map each SystemStatus to its badge display config. */
export const STATUS_BADGE: Record<SystemStatus, StatusBadgeConfig> = {
  live: {
    status: 'live',
    modifier: 'is-done',
    label: 'Live',
    description: 'Real and running — backed by a live data source for this company.',
  },
  planned: {
    status: 'planned',
    modifier: 'is-running',
    label: 'Planned',
    description: 'Simulated — this gets built and wired with real data when you go live.',
  },
}

/**
 * Derive the system status from the provisioning flags on a BusinessSystem.
 *
 * A system is 'live' when:
 *  - It has a real instance URL (pointing to a provisioned service), OR
 *  - Its `provisioned` flag is true (per-company ZeroDB data wired).
 *
 * Everything else is 'planned' — it's a plan/simulation of what will be built.
 *
 * @param opts.provisioned  True when the system's data comes from a real ZeroDB project.
 * @param opts.url          If set, the system has a real provisioned instance URL.
 */
export function deriveSystemStatus(opts: { provisioned?: boolean; url?: string }): SystemStatus {
  if (opts.url) return 'live'
  if (opts.provisioned) return 'live'
  return 'planned'
}

/**
 * Returns the full badge config for a given system based on its provisioning state.
 * Convenience wrapper: `deriveSystemStatus` → `STATUS_BADGE`.
 */
export function systemBadge(opts: { provisioned?: boolean; url?: string }): StatusBadgeConfig {
  return STATUS_BADGE[deriveSystemStatus(opts)]
}

/**
 * The one-line honest framing shown at the top of the plan/preview surface (#67).
 *
 * @param liveCount   How many systems are currently live.
 * @param totalCount  Total number of systems.
 */
export function planFramingLine(liveCount: number, totalCount: number): string {
  if (totalCount === 0) return "Cody's plan — here's what gets built when you go live."
  if (liveCount === 0) {
    return `Cody's plan — ${totalCount} system${totalCount !== 1 ? 's' : ''} get${totalCount === 1 ? 's' : ''} built and wired with real data when you go live.`
  }
  if (liveCount === totalCount) {
    return `All ${totalCount} system${totalCount !== 1 ? 's' : ''} ${totalCount !== 1 ? 'are' : 'is'} live and running.`
  }
  const plannedCount = totalCount - liveCount
  return `${liveCount} live now · ${plannedCount} more get${plannedCount === 1 ? 's' : ''} built when you go live.`
}

/**
 * Count how many systems in a list are live vs planned.
 *
 * @param systems  Array of objects with optional `provisioned` and `url` fields.
 */
export function countSystemStatuses(
  systems: Array<{ provisioned?: boolean; url?: string }>,
): { live: number; planned: number; total: number } {
  let live = 0
  let planned = 0
  for (const s of systems) {
    if (deriveSystemStatus(s) === 'live') live++
    else planned++
  }
  return { live, planned, total: systems.length }
}
