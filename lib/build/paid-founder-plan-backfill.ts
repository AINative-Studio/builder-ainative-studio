/**
 * Stuck-paid-founder plan backfill sweep (#1032).
 *
 * THE CONFIRMED CASE
 * `amador@selfpreneur.com` (company: `agentive`) was a genuine, confirmed
 * `pro` subscriber in core (`GET /api/v1/admin/users?email=…` → `"plan":"pro"`),
 * but his Builder registry row had `plan: null`. He was repaired by hand
 * (2026-10-08) via `setAppPlan('agentive', 'pro')` — the safe, already-used
 * write path. #1032 asks for the SWEEP version of that same manual check:
 * find every OTHER company in the same state, not just the one that happened
 * to be noticed.
 *
 * HOW THIS DIFFERS FROM lib/build/loop-backfill.ts (#841)
 * #841 answers "is this paid company missing its nightly-loop ENROLLMENT".
 * This module answers the narrower, upstream question #1032 is actually
 * about: "does this company's REGISTRY `plan` field itself disagree with
 * core's real plan". A company can have the correct plan stamped and still
 * be unenrolled (#841's problem), or have no plan stamped at all (this
 * module's problem) — #841 already fails closed on an unverifiable plan, but
 * it never writes `plan` back to the registry; only `setAppPlan` does that,
 * and until #1032 nothing ever called it from a sweep.
 *
 * SAFETY — mirrors #841's posture exactly, because this can write to real
 * customer registry rows:
 *  - Dry-run by default (report-only). A real write needs an explicit flag.
 *  - Uses `fetchPlanByEmail` (lib/ainative/admin-plan-lookup.ts) — the same
 *    admin-scoped, EXACT-MATCH-ONLY, fail-closed lookup #841 already uses.
 *    An unverifiable plan is skipped and logged, never guessed at.
 *  - Only ever calls `setAppPlan` (lib/build/app-registry.ts) — never a raw
 *    ZeroDB write — so this can't drift from the one real write path's own
 *    side effects (e.g. `enrolled` derived from `isPaidTier`).
 *  - Does NOT touch the ZeroDB key-claim half (tmp_ → permanent). Per the
 *    issue and CODY.md Rule 5, `claimCompanyProject`/`/instant-db/claim`
 *    authenticates against whoever's token calls it — there is no
 *    service-level workaround, and this module does not attempt one. A
 *    founder whose plan this sweep corrects still needs to log back in once
 *    for `reconcilePlanFulfillment` to finish the key migration, exactly as
 *    documented for Amador.
 *  - Never fabricates a match: a company whose registry plan is ALREADY a
 *    genuinely paid tier is not a mismatch, even if it differs in spelling
 *    from core's id (e.g. registry `business` vs core `company` — both are
 *    paid per isPaidTier/normalizeTier, so nothing is broken there).
 */

import { listAllAppsWithStatus, setAppPlan, type AppEntry } from '@/lib/build/app-registry'
import { fetchPlanByEmail } from '@/lib/ainative/admin-plan-lookup'
import { isPaidTier } from '@/lib/ainative/plan'
import { logger } from '@/lib/logger'

export type MismatchDisposition =
  | 'mismatch' // registry says unpaid/null, core says genuinely paid — the real bug
  | 'already_paid_in_registry' // registry already reflects a paid tier — nothing to fix
  | 'confirmed_unpaid' // core confirms the account is genuinely not paid (e.g. Greg Rose)
  | 'no_owner_email' // anonymous company — nothing to attribute/cross-reference
  | 'unverifiable' // core lookup failed/ambiguous — fail closed, never guessed at
  | 'deleted' // soft-deleted company — excluded entirely

export interface FounderBackfillResult {
  companyId: string
  ownerEmail?: string
  disposition: MismatchDisposition
  /** The registry's plan BEFORE this sweep touched anything. */
  registryPlan?: string | null
  /** Core's own verified plan id, when the lookup succeeded. */
  corePlan?: string | null
  /** Whether setAppPlan was actually called and returned true (never true in a dry run). */
  fixed?: boolean
  reason?: string
}

export interface FounderBackfillSweepResult {
  ok: true
  dryRun: boolean
  /** False when the registry read itself failed (core#7395) — an empty
   *  result is then NOT "no mismatches"; callers must not report success. */
  registryOk: boolean
  total: number
  mismatches: number
  fixed: number
  failed: number
  byDisposition: Record<string, number>
  results: FounderBackfillResult[]
}

function isDeleted(app: AppEntry): boolean {
  return (app as { lifecycleStatus?: string }).lifecycleStatus === 'deleted'
}

/**
 * Pure classification — given what we know about one company, decide its
 * disposition. Kept separate from the network/IO loop below so the decision
 * logic itself is directly unit-testable without mocking fetch.
 */
export function classifyFounderPlanState(input: {
  hasOwnerEmail: boolean
  registryPlanIsPaid: boolean
  planVerified: boolean
  corePlanIsPaid: boolean
}): MismatchDisposition {
  if (!input.hasOwnerEmail) return 'no_owner_email'
  // Already correct in the registry — no cross-reference needed to know that.
  if (input.registryPlanIsPaid) return 'already_paid_in_registry'
  if (!input.planVerified) return 'unverifiable'
  return input.corePlanIsPaid ? 'mismatch' : 'confirmed_unpaid'
}

/**
 * Run the stuck-paid-founder plan backfill sweep (#1032).
 *
 * `dryRun` defaults to TRUE — report-only. Pass `{ dryRun: false }` to
 * actually call `setAppPlan` for each confirmed mismatch.
 */
export async function runPaidFounderPlanBackfillSweep(
  opts: { dryRun?: boolean } = {},
): Promise<FounderBackfillSweepResult> {
  const dryRun = opts.dryRun !== false

  const { apps, ok: registryOk } = await listAllAppsWithStatus()
  if (!registryOk) {
    logger.error(
      'Paid-founder plan backfill aborted — company registry read failed; refusing to report an empty sweep as success',
      new Error('registry_read_failed'),
    )
    return {
      ok: true, dryRun, registryOk: false, total: 0,
      mismatches: 0, fixed: 0, failed: 0, byDisposition: {}, results: [],
    }
  }

  const live = apps.filter((a) => !isDeleted(a))
  const results: FounderBackfillResult[] = []
  const byDisposition: Record<string, number> = {}
  let fixed = 0
  let failed = 0

  // One founder can own several companies — cache the core lookup per owner
  // email so the sweep makes one admin call per distinct account, not one
  // per registry row (mirrors #841's loop-backfill caching).
  const planCache = new Map<string, Awaited<ReturnType<typeof fetchPlanByEmail>>>()

  for (const app of live) {
    const companyId = app.slug
    const ownerEmail = (app.ownerEmail || '').trim().toLowerCase()
    const registryPlan = app.plan ?? null

    if (!ownerEmail) {
      const d = classifyFounderPlanState({
        hasOwnerEmail: false, registryPlanIsPaid: false, planVerified: false, corePlanIsPaid: false,
      })
      byDisposition[d] = (byDisposition[d] || 0) + 1
      results.push({ companyId, disposition: d, registryPlan })
      continue
    }

    const registryPlanIsPaid = isPaidTier(registryPlan)
    // Already correctly paid in the registry — skip the core round-trip
    // entirely; there is nothing to cross-reference.
    if (registryPlanIsPaid) {
      byDisposition.already_paid_in_registry = (byDisposition.already_paid_in_registry || 0) + 1
      results.push({ companyId, ownerEmail, disposition: 'already_paid_in_registry', registryPlan })
      continue
    }

    let lookup = planCache.get(ownerEmail)
    if (!lookup) {
      lookup = await fetchPlanByEmail(ownerEmail)
      planCache.set(ownerEmail, lookup)
    }

    const corePlanIsPaid = lookup.verified && isPaidTier(lookup.plan)
    const disposition = classifyFounderPlanState({
      hasOwnerEmail: true,
      registryPlanIsPaid: false,
      planVerified: lookup.verified,
      corePlanIsPaid,
    })
    byDisposition[disposition] = (byDisposition[disposition] || 0) + 1

    if (disposition !== 'mismatch') {
      results.push({
        companyId, ownerEmail, disposition, registryPlan,
        corePlan: lookup.verified ? lookup.plan : undefined,
        reason: disposition === 'unverifiable' ? lookup.reason : undefined,
      })
      continue
    }

    // ---- Confirmed mismatch: core says genuinely paid, registry disagrees. ----

    if (dryRun) {
      results.push({
        companyId, ownerEmail, disposition, registryPlan,
        corePlan: lookup.plan, fixed: false, reason: 'dry_run',
      })
      continue
    }

    try {
      const ok = await setAppPlan(companyId, lookup.plan as string)
      if (ok) fixed += 1
      else failed += 1
      results.push({
        companyId, ownerEmail, disposition, registryPlan,
        corePlan: lookup.plan, fixed: ok, reason: ok ? undefined : 'set_plan_write_failed',
      })
    } catch (err) {
      failed += 1
      results.push({
        companyId, ownerEmail, disposition, registryPlan, corePlan: lookup.plan, fixed: false,
        reason: String((err as Error)?.message || err).slice(0, 200),
      })
      logger.warn('Paid-founder plan backfill failed to write setAppPlan', {
        companyId, err: (err as Error)?.message,
      })
    }
  }

  const mismatches = results.filter((r) => r.disposition === 'mismatch').length

  return {
    ok: true, dryRun, registryOk: true,
    total: live.length, mismatches, fixed, failed, byDisposition, results,
  }
}
