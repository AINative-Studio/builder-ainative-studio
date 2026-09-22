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

/**
 * Paid-conversion follow-through decision (#813/#819/#821).
 *
 * Pure utility — no imports, no side effects, fully testable. Decides whether a
 * VERIFIED-PAID checkout should trigger the two real follow-through actions a
 * founder expects the moment they pay: (1) provisioning the company's dedicated
 * deploy service, and (2) kicking off an initial autonomous-loop run so a real
 * backlog exists from day one, instead of leaving the founder waiting on a
 * manual "Start Auto Mode" click or the next nightly cron tick (which could be
 * up to 24h away, or simply never happen if the cron itself is broken).
 *
 * Both decisions are idempotency gates, not the side-effecting calls themselves
 * (see app/api/build/subscription/verify/route.ts, which calls the real
 * deployCompanyFromGitea / runNightlyLoop functions guarded by these). Kept
 * separate from those I/O functions so the "when do we act" logic is testable
 * without mocking Railway or the agent swarm.
 */

/** Input for {@link shouldProvisionDeployService}. */
export interface ProvisionDecisionInput {
  /** Core's Stripe-session verification result — never trust an unverified paid flag. */
  paid: boolean
  /** The company already has a persisted railwayServiceId. */
  alreadyProvisioned: boolean
  /** The company has progressed far enough (a real chatId) to have deployable content. */
  hasChatId: boolean
}

/**
 * Whether THIS verify call should attempt to provision (or redeploy) the
 * company's dedicated Railway service.
 *
 * Provisioning a NEW service only happens for a genuinely, verifiably paid
 * company that has real content to deploy — never for a company still mid
 * generation (no chatId yet). An already-provisioned company still returns
 * true so the caller redeploys current content (idempotent — never a second
 * billable service; see deployCompanyFromGitea's alreadyProvisioned contract).
 */
export function shouldProvisionDeployService(input: ProvisionDecisionInput): boolean {
  if (!input.paid) return false
  if (!input.hasChatId) return false
  return true
}

/** Input for {@link shouldStartInitialRun}. */
export interface InitialRunDecisionInput {
  /** Core's Stripe-session verification result — never trust an unverified paid flag. */
  paid: boolean
  /** The verified plan unlocks the autonomous loop (Business+ — see planUnlocks().nightlyLoop). */
  planUnlocksLoop: boolean
  /** The company is ALREADY enrolled in the loop store (a prior verify call, or the manual "Hire the swarm" button). */
  alreadyEnrolled: boolean
}

/**
 * Whether THIS verify call should fire the initial autonomous-loop dispatch
 * (enroll + one immediate runNightlyLoop, mirroring what the manual "Start Auto
 * Mode" button already does) so a real backlog task exists from day one.
 *
 * Guarded by alreadyEnrolled to stay idempotent — a webhook/verify retry (page
 * refresh, duplicate confirmation) must never enroll or dispatch twice; the
 * loop-enrollment store has no dedup of its own (see loop-enrollment.ts),
 * so this decision is the ONLY thing standing between a retried request and a
 * company enrolled (and dispatched) N times.
 */
export function shouldStartInitialRun(input: InitialRunDecisionInput): boolean {
  if (!input.paid) return false
  if (!input.planUnlocksLoop) return false
  if (input.alreadyEnrolled) return false
  return true
}

/** Input for {@link classifyBackfillCandidate} (#841). */
export interface BackfillCandidateInput {
  /**
   * Core's plan lookup succeeded and gave an unambiguous answer. False means
   * "we could not check" (timeout/5xx/ambiguous email match) — NEVER the same
   * as "not paid". See lib/ainative/admin-plan-lookup.ts.
   */
  planVerified: boolean
  /** The account is on a genuinely paid tier (isPaidTier over core's plan). */
  paid: boolean
  /** That paid tier unlocks the nightly loop — Business+ (planUnlocks().nightlyLoop). */
  planUnlocksLoop: boolean
  /** A real, enabled row already exists in builder_loop_enrollments. */
  alreadyEnrolled: boolean
  /** The registry row carries an ownerEmail we can attribute a plan to. */
  hasOwnerEmail: boolean
}

/**
 * Why a company was or wasn't picked up by the #841 backfill sweep. Every
 * company in the registry lands in exactly one of these buckets, and the sweep
 * reports all of them — a skip is never silent.
 *
 *  - 'enroll'            → genuinely paid, loop-eligible, not yet enrolled. ACT.
 *  - 'already_enrolled'  → the fix already happened (or the founder self-served).
 *  - 'paid_not_loop_tier'→ REALLY paying, but on a tier that does not include the
 *                          nightly loop (Pro is rank 1; the loop is Business+).
 *                          Deliberately NOT enrolled: doing so would hand every
 *                          Pro customer billable swarm dispatches they never
 *                          bought. Reported separately because this is a
 *                          PRODUCT decision for a human, not a bug to auto-fix.
 *  - 'not_paid'          → confirmed free/unpaid. Correctly out of scope.
 *  - 'no_owner_email'    → anonymous build; there is no account to attribute.
 *  - 'unverifiable'      → core could not be asked. Fails CLOSED (skip + log),
 *                          so a core outage can never mass-enroll companies.
 */
export type BackfillDisposition =
  | 'enroll'
  | 'already_enrolled'
  | 'paid_not_loop_tier'
  | 'not_paid'
  | 'no_owner_email'
  | 'unverifiable'

/**
 * Decide what the #841 backfill should do with ONE company. Pure, so the
 * safety rules that guard real customer dispatches are unit-testable without
 * mocking ZeroDB, core, or the agent swarm.
 *
 * Order matters: the cheap structural skips come first, then the fail-closed
 * verification gate, and only a fully-confirmed company can reach 'enroll'.
 * `alreadyEnrolled` is checked before any paid reasoning so an already-correct
 * company is inert no matter what core says — that is what makes re-running
 * the sweep idempotent.
 */
export function classifyBackfillCandidate(
  input: BackfillCandidateInput,
): BackfillDisposition {
  if (!input.hasOwnerEmail) return 'no_owner_email'
  if (input.alreadyEnrolled) return 'already_enrolled'
  // Fail closed: "couldn't verify" must never be read as "go ahead".
  if (!input.planVerified) return 'unverifiable'
  if (!input.paid) return 'not_paid'
  if (!input.planUnlocksLoop) return 'paid_not_loop_tier'
  return 'enroll'
}
