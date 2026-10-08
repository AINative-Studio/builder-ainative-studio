/**
 * Server-side registration reconciliation (#1015).
 *
 * THE GAP THIS CLOSES
 * `POST /api/build/register-app` is the step that makes a founder's generated
 * code REAL: it runs the pre-deploy ready gate and the git commit, and reports
 * the `ready_check` + `git_commit` deployment-health stages. It is invoked from
 * EXACTLY ONE place in the whole codebase — a client-side `useEffect` in
 * components/build/artifacts/Preview.tsx, gated on local React state
 * (`status === 'ready'` and `state.appSub`). There is no cron, no webhook, no
 * retry and no reconciliation behind it. So if the founder's tab closes,
 * generation stalls before `status` flips, a network blip drops the request, or
 * they simply navigate away, those two steps never run for that company ever,
 * and nothing notices.
 *
 * The live case this was built from (company "Flo", 2026-10-07):
 *   GET /api/v1/public/deployment-health/builder_app_generation/flo
 *   → stages: [ {generate, ok}, {register, ok} ]      (total: 2)
 * `ready_check` and `git_commit` entirely absent — and the founder's live page
 * genuinely renders no trace of their actual business idea. Seven hours after
 * creation, inside an open 72-hour trial window, they had nothing to show.
 *
 * Structurally identical to #1012 (plan fulfilment) and #1014: a critical
 * pipeline step gated on a browser event completing, with no server-side
 * fallback.
 *
 * HOW THIS DETECTS A STUCK COMPANY
 * Core's deployment-health telemetry is the real signal and the only one that
 * can tell these states apart — the registry row for a stuck company looks
 * perfectly healthy (Flo's has a `deployUrl` and no error field anywhere).
 * There is no list/summary variant of core's GET (verified live: requesting
 * `.../builder_app_generation/summary` just returns an entity literally named
 * "summary" with zero stages), so the sweep enumerates candidates from the
 * registry and reads stages per slug — the same shape as loop-backfill.ts.
 *
 * SAFETY
 *  - Dry-run by DEFAULT. A real run needs an explicit flag, mirroring
 *    runLoopBackfillSweep / runWinbackSweep. A real run commits code to real
 *    customer repos.
 *  - IDEMPOTENT. Disposition is re-read per company immediately before acting,
 *    so a company whose `ready_check` already exists is a strict no-op. Running
 *    the sweep twice (or racing a live client-side register-app) cannot
 *    re-commit anyone's code.
 *  - FAILS CLOSED. An unverifiable stage read is skipped, never assumed stuck,
 *    so a core outage degrades to "did nothing" rather than re-driving the whole
 *    platform.
 *  - LEAVES THE WRONG CASES ALONE. A company with no successful `generate`
 *    stage is NOT this bug class — there is no generated code to verify or
 *    commit, and inventing a registration for it would be worse than the bug.
 *    Same for one the gate already rejected: that is /api/build/repair-app's
 *    job, not reconciliation's.
 *  - Uses the founder's OWN stored registry data (chatId, name, repo/project
 *    ids) — nothing is re-asked from a client, and no founder session is
 *    borrowed or impersonated. The two steps this re-drives need only Builder's
 *    own service credentials (CODY.md Rule 5 is satisfied because no
 *    founder-scoped provisioning happens here: the git repo and ZeroDB project
 *    were already provisioned under the founder's own identity at
 *    provision time; this only commits code into what already exists).
 *  - Reuses register-app's ACTUAL logic via lib/build/register-app-core.ts
 *    rather than reimplementing the gate or the commit, so the client-triggered
 *    path and this repair path can never drift apart.
 */

import { listAllAppsWithStatus, resolveApp, type AppEntry } from '@/lib/build/app-registry'
import {
  fetchDeploymentHealthStages,
  classifyRegistrationHealth,
  type RegistrationHealthDisposition,
} from '@/lib/build/deployment-health'
import { runReadyGate, runGitCommit } from '@/lib/build/register-app-core'
import { logger } from '@/lib/logger'

/**
 * Hard cap on real reconciliations per run. Each one can push a real commit to
 * a real customer repo, so a bug in the candidate filter cannot turn into an
 * unbounded burst. A legitimately larger backlog drains over successive runs.
 */
export const MAX_RECONCILES_PER_RUN = 25

/** Git commit message label, so the history says plainly why this commit exists. */
const RECONCILE_TASK_LABEL = 'server-side registration reconciliation (#1015)'

export interface ReconcileCompanyResult {
  slug: string
  disposition: RegistrationHealthDisposition | 'unknown'
  /** True only when the gate + commit were genuinely re-driven for real. */
  reconciled: boolean
  /** Whether the re-run gate reached a verdict (false = unverifiable, failed open). */
  readyChecked?: boolean
  /** Whether a real git commit landed. Never a guess. */
  gitCommitted?: boolean
  /** Populated on any skip or failure — never fabricated. */
  reason?: string
}

export interface ReconcileSweepResult {
  ok: true
  dryRun: boolean
  /** False when the registry read itself failed — an empty result is then NOT
   *  "no companies" (core#7395). Callers must not report success on this. */
  registryOk: boolean
  total: number
  /** Companies genuinely stuck in the #1015 state. */
  candidates: number
  /** Companies actually re-driven (always 0 in a dry run). */
  reconciled: number
  /** Of those, how many landed a real git commit. */
  committed: number
  skipped: number
  byDisposition: Record<string, number>
  results: ReconcileCompanyResult[]
}

/** A company the sweep must never touch (soft-deleted in the registry). */
function isDeleted(app: Pick<AppEntry, 'slug'> & { lifecycleStatus?: string }): boolean {
  return app.lifecycleStatus === 'deleted'
}

/**
 * Reconcile ONE company by slug.
 *
 * Resolves its real registry row, reads its real recorded stages from core, and
 * — only if it is genuinely in the #1015 stuck state — re-runs the identical
 * ready gate and git commit that register-app's client-triggered path runs.
 *
 * Never throws. A reconciliation hiccup must never turn a page load or a cron
 * tick into a visible error.
 */
export async function reconcileRegistration(
  slug: string,
  opts: { dryRun?: boolean } = {},
): Promise<ReconcileCompanyResult> {
  const dryRun = opts.dryRun === true

  try {
    const entry = await resolveApp(slug)
    if (!entry) {
      return { slug, disposition: 'unknown', reconciled: false, reason: 'no_registry_entry' }
    }
    if (!entry.chatId) {
      // No chatId means there is no generation to resolve stored code for, so
      // neither the gate nor the commit has anything to act on.
      return { slug, disposition: 'unknown', reconciled: false, reason: 'no_chat_id' }
    }

    const read = await fetchDeploymentHealthStages('builder_app_generation', slug)
    const disposition = classifyRegistrationHealth(read)

    if (disposition !== 'stuck') {
      // complete / never_generated / generation_failed / ready_check_failed /
      // unverifiable — all correctly left alone. See the file header.
      return { slug, disposition, reconciled: false }
    }

    if (dryRun) {
      return { slug, disposition, reconciled: false, reason: 'dry_run' }
    }

    // ---- Genuinely stuck. Re-drive the real pipeline. ----

    // The gate reports its own `ready_check` stage, which is also what makes
    // this idempotent on the next run: once it has adjudicated, this company
    // classifies as `complete` and is never touched again.
    const gate = await runReadyGate(slug, entry.chatId)
    if (gate.blocked) {
      // The app is genuinely broken. The gate recorded `ready_check: failed`,
      // so this company now classifies as ready_check_failed and will not be
      // retried here — repair/regeneration is a separate path.
      return {
        slug,
        disposition,
        reconciled: false,
        readyChecked: true,
        reason: 'ready_gate_blocked',
      }
    }

    const commit = await runGitCommit({
      slug,
      chatId: entry.chatId,
      existing: entry,
      taskLabel: RECONCILE_TASK_LABEL,
    })

    return {
      slug,
      disposition,
      reconciled: true,
      readyChecked: gate.ready.checked,
      gitCommitted: commit.committed,
    }
  } catch (err) {
    logger.warn('Registration reconciliation failed for company', {
      slug,
      err: (err as Error)?.message,
    })
    return {
      slug,
      disposition: 'unknown',
      reconciled: false,
      reason: String((err as Error)?.message || err).slice(0, 200),
    }
  }
}

/**
 * Run the reconciliation sweep.
 *
 * `dryRun` defaults to TRUE — an accidental call, a health probe, or a cron
 * ping with no explicit flag must never push a commit to a real customer repo
 * (the same posture as runLoopBackfillSweep).
 *
 * Pass `slug` to reconcile exactly one company instead of enumerating the whole
 * registry — that is the shape a per-company touchpoint (a dashboard load)
 * should use, so a single founder's page view does not sweep the platform.
 */
export async function runRegistrationReconcileSweep(
  opts: { dryRun?: boolean; slug?: string } = {},
): Promise<ReconcileSweepResult> {
  const dryRun = opts.dryRun !== false

  // Single-company mode: no registry enumeration at all.
  if (opts.slug) {
    const result = await reconcileRegistration(opts.slug, { dryRun })
    return {
      ok: true,
      dryRun,
      registryOk: true,
      total: 1,
      candidates: result.disposition === 'stuck' ? 1 : 0,
      reconciled: result.reconciled ? 1 : 0,
      committed: result.gitCommitted ? 1 : 0,
      skipped: result.reconciled ? 0 : 1,
      byDisposition: { [result.disposition]: 1 },
      results: [result],
    }
  }

  const { apps, ok: registryOk } = await listAllAppsWithStatus()
  if (!registryOk) {
    // A failed read is NOT "zero companies" (core#7395). Report it honestly and
    // do nothing, rather than logging a clean "0 reconciled" success.
    logger.error(
      'Registration reconciliation aborted — company registry read failed; refusing to report an empty sweep as success',
      new Error('registry_read_failed'),
    )
    return {
      ok: true, dryRun, registryOk: false, total: 0, candidates: 0,
      reconciled: 0, committed: 0, skipped: 0, byDisposition: {}, results: [],
    }
  }

  const live = apps.filter((a) => !isDeleted(a as AppEntry & { lifecycleStatus?: string }))
  const results: ReconcileCompanyResult[] = []
  const byDisposition: Record<string, number> = {}
  let reconciled = 0
  let committed = 0

  for (const app of live) {
    // Cap REAL work only. Candidates past the cap are still classified and
    // reported so the next run's backlog is visible, never silently dropped.
    const capped = !dryRun && reconciled >= MAX_RECONCILES_PER_RUN
    const result = await reconcileRegistration(app.slug, { dryRun: dryRun || capped })

    if (capped && result.disposition === 'stuck') {
      result.reason = 'run_cap_reached'
    }

    byDisposition[result.disposition] = (byDisposition[result.disposition] || 0) + 1
    if (result.reconciled) {
      reconciled += 1
      if (result.gitCommitted) committed += 1
    }
    results.push(result)
  }

  const candidates = results.filter((r) => r.disposition === 'stuck').length

  return {
    ok: true,
    dryRun,
    registryOk: true,
    total: live.length,
    candidates,
    reconciled,
    committed,
    skipped: results.length - reconciled,
    byDisposition,
    results,
  }
}
