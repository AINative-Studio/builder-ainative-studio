/**
 * Paid-but-never-enrolled backfill sweep (#841) — the retroactive half of #826.
 *
 * THE GAP THIS CLOSES
 * #826 made a paid conversion auto-enroll a company into the nightly autonomous
 * loop, but only ON the conversion: the enroll+dispatch fires inside
 * `POST /api/build/subscription/verify`, the route the Live dashboard calls when
 * Stripe redirects a founder back. That fixed every conversion GOING FORWARD and
 * nothing behind it. A company that was already paid-but-never-enrolled when
 * #826 shipped stays stuck forever — there is no second trigger, so its Tasks &
 * backlog stays permanently empty and Auto Mode stays OFF. `agentive` (#841) is
 * a real, confirmed instance.
 *
 * It is worth being precise about how a paid company ends up unenrolled at all,
 * because it is not a rare race — `builder_app_registry.plan` is written from
 * EXACTLY ONE place (setAppPlan ← the verify route), fire-and-forget. Measured
 * live while building this (#841): ALL 134 distinct companies in the production
 * registry have `plan: null`. Not one row has ever carried a plan. So any sweep
 * keyed on the registry's own `plan` field would match zero companies and
 * "succeed" while fixing nothing — including for `agentive`, whose owner really
 * is paying. The registry is simply not a source of truth about billing.
 *
 * THE REAL SIGNAL
 * Core is. `GET /api/v1/admin/users?email=<email>` answers with core's own plan
 * id for an arbitrary account, using Builder's admin-scoped service key and NO
 * founder session (lib/ainative/admin-plan-lookup.ts). That is what makes an
 * offline sweep possible at all: we join `builder_app_registry.ownerEmail` →
 * core plan → `builder_loop_enrollments`, and act only where all three agree.
 *
 * SAFETY — this sweep can fire REAL, billable swarm dispatches at REAL customers
 *  - Dry-run by default. A real run needs an explicit flag, mirroring
 *    app/api/cron/comms-digest and app/api/cron/winback.
 *  - Idempotent. `alreadyEnrolled` is checked per company immediately before
 *    acting, so re-running the sweep (or racing the verify route) cannot
 *    double-enroll or double-dispatch. The enrollment store has no dedup of its
 *    own (loop-enrollment.ts is append-only), so this check is the only guard.
 *  - Fails CLOSED. A plan we could not verify is skipped and logged, never
 *    assumed paid — so a core outage degrades to "did nothing", not to a mass
 *    enrollment of unpaid companies.
 *  - Reuses #826's decision logic rather than reimplementing it: the same
 *    shouldStartInitialRun() gate, the same enrollCompany() + runNightlyLoop()
 *    pair, in the same order.
 *  - Never fabricates success: a failed enroll is counted as failed, and a
 *    dispatch failure is reported per company.
 */

import { listAllAppsWithStatus, type AppEntry } from '@/lib/build/app-registry'
import { enrollCompany, isEnrolled } from '@/lib/build/loop-enrollment'
import { runNightlyLoop } from '@/lib/build/autonomous-loop'
import {
  classifyBackfillCandidate,
  shouldStartInitialRun,
  type BackfillDisposition,
} from '@/lib/build/live-vs-planned'
import { fetchPlanByEmail } from '@/lib/ainative/admin-plan-lookup'
import { isPaidTier, normalizeTier } from '@/lib/ainative/plan'
import { planUnlocks } from '@/lib/build/state'
import type { ActivePlan } from '@/lib/build/state'
import { logger } from '@/lib/logger'

/**
 * Hard cap on real enrollments per run. Each enrollment fires one immediate
 * runNightlyLoop — a real, billable swarm dispatch — so a bug in the candidate
 * filter cannot turn into an unbounded burst of customer-visible work. Measured
 * reality (#841): only a single-digit number of companies qualify, so this cap
 * is headroom, not a limiter. A legitimate larger backlog can be drained by
 * running the sweep again.
 */
export const MAX_ENROLLMENTS_PER_RUN = 25

export interface BackfillCompanyResult {
  companyId: string
  disposition: BackfillDisposition
  /** Core's raw plan id, when we got a verified answer. */
  plan?: string | null
  /** Whether a real enrollment row was written (never true in a dry run). */
  enrolled?: boolean
  /** Whether the initial loop dispatch actually succeeded. */
  dispatched?: boolean
  /** Populated on a failure or a fail-closed skip — never a guess. */
  reason?: string
}

export interface BackfillSweepResult {
  ok: true
  dryRun: boolean
  /** False when the registry read itself failed — an empty result is then NOT
   *  "no companies" (core#7395). Callers must not report success on this. */
  registryOk: boolean
  total: number
  /** Companies that qualify: genuinely paid, loop-eligible, not yet enrolled. */
  candidates: number
  enrolled: number
  dispatched: number
  skipped: number
  failed: number
  /** Counts per disposition, so every skip is accounted for, never silent. */
  byDisposition: Record<string, number>
  results: BackfillCompanyResult[]
}

/**
 * Map core's plan id onto Builder's ActivePlan vocabulary so `planUnlocks()`
 * answers the same way it does for a live, signed-in founder. normalizeTier
 * folds core's aliases (launch→pro, company→business) first; anything Builder
 * does not recognise as a paid ActivePlan resolves to '' (locked), which is the
 * safe direction.
 */
export function toActivePlan(corePlan: string | null | undefined): ActivePlan {
  const tier = normalizeTier(corePlan)
  const known: ActivePlan[] = ['pro', 'business', 'enterprise', 'cody_vcto']
  return (known as string[]).includes(tier) ? (tier as ActivePlan) : ''
}

/** A company the sweep should never consider (soft-deleted in the registry). */
function isDeleted(app: AppEntry): boolean {
  return (app as { lifecycleStatus?: string }).lifecycleStatus === 'deleted'
}

/**
 * Run the backfill sweep.
 *
 * `dryRun` defaults to TRUE — an accidental call, a probe, or a cron ping with
 * no explicit flag must never enroll a real customer (the same posture as
 * runWinbackSweep's `opts.dryRun !== false`).
 */
export async function runLoopBackfillSweep(
  opts: { dryRun?: boolean } = {},
): Promise<BackfillSweepResult> {
  const dryRun = opts.dryRun !== false

  const { apps, ok: registryOk } = await listAllAppsWithStatus()
  if (!registryOk) {
    // A failed read is NOT "zero companies" (core#7395). Report it honestly and
    // do nothing, rather than logging a clean "0 enrolled" success.
    logger.error(
      'Loop backfill aborted — company registry read failed; refusing to report an empty sweep as success',
      new Error('registry_read_failed'),
    )
    return {
      ok: true, dryRun, registryOk: false, total: 0, candidates: 0,
      enrolled: 0, dispatched: 0, skipped: 0, failed: 0,
      byDisposition: {}, results: [],
    }
  }

  const live = apps.filter((a) => !isDeleted(a))
  const results: BackfillCompanyResult[] = []
  const byDisposition: Record<string, number> = {}
  let enrolled = 0
  let dispatched = 0
  let failed = 0

  // Plan lookups are per-ACCOUNT, but one founder commonly owns several
  // companies (measured: 48 registry rows across 13 distinct owners). Cache so
  // a sweep makes ~13 core calls, not ~48.
  const planCache = new Map<string, Awaited<ReturnType<typeof fetchPlanByEmail>>>()

  for (const app of live) {
    const companyId = app.slug
    const ownerEmail = (app.ownerEmail || '').trim().toLowerCase()

    // Structural skip first — no account to attribute, so nothing to verify.
    if (!ownerEmail) {
      const d = classifyBackfillCandidate({
        planVerified: false, paid: false, planUnlocksLoop: false,
        alreadyEnrolled: false, hasOwnerEmail: false,
      })
      byDisposition[d] = (byDisposition[d] || 0) + 1
      results.push({ companyId, disposition: d })
      continue
    }

    // Read enrollment state per company, immediately before acting, so the
    // sweep is idempotent against its own prior runs AND against a concurrent
    // verify-route enrollment.
    let alreadyEnrolled = false
    try {
      alreadyEnrolled = await isEnrolled(companyId)
    } catch {
      // Unknown enrollment state ⇒ fail closed. Enrolling on a failed read is
      // exactly how a company gets double-enrolled and double-dispatched.
      byDisposition.unverifiable = (byDisposition.unverifiable || 0) + 1
      results.push({ companyId, disposition: 'unverifiable', reason: 'enrollment_check_failed' })
      continue
    }

    let lookup = planCache.get(ownerEmail)
    if (!lookup) {
      lookup = await fetchPlanByEmail(ownerEmail)
      planCache.set(ownerEmail, lookup)
    }

    const activePlan = lookup.verified ? toActivePlan(lookup.plan) : ''
    const disposition = classifyBackfillCandidate({
      planVerified: lookup.verified,
      paid: lookup.verified && isPaidTier(lookup.plan),
      planUnlocksLoop: planUnlocks(activePlan).nightlyLoop,
      alreadyEnrolled,
      hasOwnerEmail: true,
    })
    byDisposition[disposition] = (byDisposition[disposition] || 0) + 1

    if (disposition !== 'enroll') {
      results.push({
        companyId,
        disposition,
        plan: lookup.verified ? lookup.plan : undefined,
        reason: disposition === 'unverifiable' ? lookup.reason : undefined,
      })
      continue
    }

    // ---- From here the company genuinely qualifies. ----

    if (dryRun) {
      results.push({ companyId, disposition, plan: lookup.plan, enrolled: false, reason: 'dry_run' })
      continue
    }

    if (enrolled >= MAX_ENROLLMENTS_PER_RUN) {
      results.push({ companyId, disposition, plan: lookup.plan, enrolled: false, reason: 'run_cap_reached' })
      continue
    }

    // Reuse #826's own gate verbatim rather than trusting the classification
    // alone — one shared definition of "may we start a loop for this company",
    // so the backfill and the conversion path can never drift apart.
    if (!shouldStartInitialRun({ paid: true, planUnlocksLoop: true, alreadyEnrolled })) {
      results.push({ companyId, disposition, plan: lookup.plan, enrolled: false, reason: 'initial_run_gate_declined' })
      continue
    }

    try {
      const track = app.track === 'company' ? 'company' : 'app'
      const ok = await enrollCompany({
        companyId,
        companyName: app.name || companyId,
        track,
        ownerKey: ownerEmail,
      })
      if (!ok) {
        failed += 1
        results.push({ companyId, disposition, plan: lookup.plan, enrolled: false, reason: 'enroll_write_failed' })
        continue
      }
      enrolled += 1

      // Mirror #826: enroll, THEN fire ONE immediate dispatch so a real backlog
      // task exists straight away instead of waiting on the next nightly tick.
      // A swarm hiccup must not undo the enrollment — the nightly cron will
      // still pick the company up — so this is reported, not fatal.
      const run = await runNightlyLoop({ companyId, companyName: app.name || companyId, track })
        .catch((err: unknown) => ({ status: 'error', detail: String((err as Error)?.message || err).slice(0, 200) }))
      const didDispatch = (run as { status?: string })?.status === 'dispatched'
      if (didDispatch) dispatched += 1
      results.push({
        companyId, disposition, plan: lookup.plan, enrolled: true, dispatched: didDispatch,
        reason: didDispatch ? undefined : `dispatch_${(run as { status?: string })?.status || 'failed'}`,
      })
    } catch (err) {
      failed += 1
      results.push({
        companyId, disposition, plan: lookup.plan, enrolled: false,
        reason: String((err as Error)?.message || err).slice(0, 200),
      })
      logger.warn('Loop backfill failed for company', { companyId, err: (err as Error)?.message })
    }
  }

  const candidates = results.filter((r) => r.disposition === 'enroll').length
  const skipped = results.length - candidates

  return {
    ok: true, dryRun, registryOk: true,
    total: live.length, candidates, enrolled, dispatched, skipped, failed,
    byDisposition, results,
  }
}
