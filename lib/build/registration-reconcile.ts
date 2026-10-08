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
 *    path and this repair path can never drift apart. It calls that shared module
 *    directly rather than fetching the route: the route also appends an
 *    unconditional, un-deduped registry row (against a table read with a hard
 *    `?limit=1000` cap), and a self-fetch would need to cross the middleware
 *    boundary with an absolute origin URL. See register-app-core.ts's header for
 *    the full reasoning, including two risks commonly assumed here that are
 *    provably NOT reachable on this path.
 *  - A company whose code can no longer be resolved at all is reported as
 *    UNRESOLVED (`reason: 'no_stored_code'`), never as a reconciliation, and gets
 *    a terminal `ready_check: skipped` so it stops being re-swept forever. See
 *    reconcileRegistration's own comment at that branch.
 */

import { listAllAppsWithStatus, resolveApp, type AppEntry } from '@/lib/build/app-registry'
import {
  fetchDeploymentHealthStages,
  classifyRegistrationHealth,
  reportDeploymentHealthStage,
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

/**
 * Wall-clock budget for one whole sweep, in ms.
 *
 * MAX_RECONCILES_PER_RUN caps WRITES; this caps the READ pass, which is where the
 * time actually goes. Every live company (~162 in production) costs a sequential
 * `resolveApp` + `fetchDeploymentHealthStages`, each with its own 15s timeout, so
 * the read pass alone can approach the cron route's `maxDuration = 300` even
 * though only 25 companies can ever be written.
 *
 * Overrunning that ceiling is strictly worse than stopping short: the platform
 * kills the handler mid-iteration, nothing is persisted, the response never
 * returns, and the next run restarts from the top of the SAME iteration order —
 * so companies late in that order starve while the early ones are re-read on
 * every run. 250s leaves ~50s of headroom to finish the in-flight company and
 * serialize an honest, explicitly-truncated response.
 */
export const SWEEP_BUDGET_MS = 250_000

/** Git commit message label, so the history says plainly why this commit exists. */
const RECONCILE_TASK_LABEL = 'server-side registration reconciliation (#1015)'

/**
 * The one terminal outcome this pass can reach without finishing anything: the
 * company's generated code is no longer resolvable from EITHER store, so there is
 * nothing to gate and nothing to commit. Used both as the recorded stage reason
 * and as the reported result reason, so the telemetry and the sweep counters say
 * the same thing.
 */
const NO_STORED_CODE = 'no_stored_code'

export interface ReconcileCompanyResult {
  slug: string
  disposition: RegistrationHealthDisposition | 'unknown'
  /**
   * True only when the gate or the commit genuinely DID something — a real gate
   * verdict was recorded, or a real commit was attempted. A pass where neither
   * step could act (no stored code left to act on) is `false` with
   * `reason: 'no_stored_code'`, never a success: nothing changed, so claiming
   * otherwise would both overstate the run and hide a company that needs a real
   * regeneration.
   */
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
  /**
   * True when the sweep stopped early on its wall-clock budget rather than
   * reaching every live company. The counts below it then describe only the
   * companies actually examined — never the whole platform.
   */
  truncated: boolean
  /** Live companies never reached on this run. 0 on a complete sweep. */
  remaining: number
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

    // UNRECOVERABLE CODE (code review, #1015 follow-up).
    //
    // The gate reporting no verdict AND the commit attempting nothing is the
    // signature of one specific thing: `resolveStoredApp` found no code at all.
    // The in-memory preview store is process-local (lib/preview-store.ts), so a
    // browser that died mid-generation may never have landed a durable ZeroDB
    // copy — and then there is nothing for the gate to parse and nothing for the
    // commit to push. Neither step reports a stage in that case, by design (a
    // fabricated `ok`, or a phantom `failed` for a company that legitimately has
    // nowhere to commit, would both be worse).
    //
    // The consequence, if this returned `reconciled: true` anyway: the company's
    // stage set is byte-identical to before the run, so classifyRegistrationHealth
    // calls it `stuck` on the very next sweep — and every sweep after that,
    // forever, each one spending a registry read, a stage read, and four gate
    // attempts with retry sleeps on work that can never succeed. Meanwhile the
    // run's own `reconciled` counter would claim success for a company nothing
    // happened to.
    //
    // So: report it honestly as unresolved, AND record a terminal
    // `ready_check: skipped` carrying the real reason, which classifies the
    // company as `unrecoverable` from here on. Only a genuine regeneration (which
    // writes new code and a real `ready_check`) can move it forward.
    if (!gate.ready.checked && !commit.attempted) {
      await reportDeploymentHealthStage(
        'builder_app_generation', slug, 'ready_check', 'skipped', NO_STORED_CODE,
      )
      return {
        slug,
        disposition,
        reconciled: false,
        readyChecked: false,
        gitCommitted: false,
        reason: NO_STORED_CODE,
      }
    }

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
 *
 * Bounded by SWEEP_BUDGET_MS of wall clock: a sweep that would overrun the cron
 * route's maxDuration stops early and says so (`truncated` + `remaining`) rather
 * than being killed mid-iteration with nothing persisted and nothing returned.
 *
 * `budgetMs` and `now` are injectable for tests only — production uses the
 * SWEEP_BUDGET_MS default and the real clock.
 */
export async function runRegistrationReconcileSweep(
  opts: { dryRun?: boolean; slug?: string; budgetMs?: number; now?: () => number } = {},
): Promise<ReconcileSweepResult> {
  const dryRun = opts.dryRun !== false
  const budgetMs = opts.budgetMs ?? SWEEP_BUDGET_MS
  const now = opts.now ?? (() => Date.now())
  const startedAt = now()

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
      // One explicitly-named company is never a partial sweep of the platform.
      truncated: false,
      remaining: 0,
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
      reconciled: 0, committed: 0, skipped: 0, truncated: false, remaining: 0,
      byDisposition: {}, results: [],
    }
  }

  const live = apps.filter((a) => !isDeleted(a as AppEntry & { lifecycleStatus?: string }))
  const results: ReconcileCompanyResult[] = []
  const byDisposition: Record<string, number> = {}
  let reconciled = 0
  let committed = 0

  for (const app of live) {
    // WALL-CLOCK DEADLINE. Checked BEFORE starting a company, so the budget's
    // headroom covers finishing the one already in flight plus serializing the
    // response. `results.length > 0` guarantees forward progress even on a budget
    // already spent when the loop begins — a sweep that always did nothing would
    // be the same starvation this check exists to prevent. (reconcileRegistration
    // never throws, so every iteration pushes exactly one result: results.length
    // is the real count of companies examined.)
    if (results.length > 0 && now() - startedAt >= budgetMs) break

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
  const remaining = live.length - results.length
  const truncated = remaining > 0

  if (truncated) {
    // Surfaced as a warning, not swallowed: a sweep that cannot finish the
    // platform inside its budget is an operational signal (the read pass needs
    // batching or concurrency), not a routine outcome.
    logger.warn('Registration reconciliation sweep truncated on its wall-clock budget', {
      examined: results.length,
      remaining,
      budgetMs,
      total: live.length,
    })
  }

  return {
    ok: true,
    dryRun,
    registryOk: true,
    // The real live-company count, NOT how many were reached — a truncated run
    // must not make the platform look smaller than it is. `results.length` plus
    // `remaining` is what was examined vs. left.
    total: live.length,
    candidates,
    reconciled,
    committed,
    skipped: results.length - reconciled,
    truncated,
    remaining,
    byDisposition,
    results,
  }
}
