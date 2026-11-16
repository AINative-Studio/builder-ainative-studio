/**
 * Task resolution loop (#433, epic #371) — the nightly-loop hook that finally
 * gives resolveTask() its first real caller. Sits alongside the media-routine
 * runner in the nightly loop (same convention — see media-routine.ts).
 *
 * #371 built a complete, real, coverage-gated execution pipeline
 * (task-resolver.ts's resolveTask(): LLM-implement → Gitea commit+PR →
 * vitest --coverage verify → honest completed/failed stage, never fabricates
 * a pass) but nothing in the running app ever called it — confirmed via
 * exhaustive search (#433). A `todo` task, regardless of source
 * (cody/swarm/recurring), sat forever with no path to real execution.
 *
 * This runs one resolveTask() attempt per DUE (`stage: 'todo'`) task per
 * company scope, per nightly run. Best-effort throughout, matching every
 * other nightly-loop hook: a per-task failure is swallowed (resolveTask
 * itself already records the real failure reason on the task — see
 * task-resolver.ts — so nothing is silently lost, it just doesn't stop the
 * loop from continuing to the next task/company).
 *
 * #904 (epic #900, depends on #902/#903) — before resolving the DUE list,
 * every `todo` task flagged `needsSplit` (#903: estimated at 3/5/8 points)
 * is now run through `lib/build/task-splitter.ts`'s `splitTask()` instead of
 * being left to sit in the backlog forever. Same best-effort contract: a
 * splitter failure leaves that parent task untouched (still `todo`) for a
 * future nightly retry, and never blocks resolution of this run's other,
 * smaller due tasks.
 */

import { listTasks, updateTask, needsSplit, type BuildTask } from '@/lib/build/task-store'
import { resolveTask } from '@/lib/build/task-resolver'
import { splitTask } from '@/lib/build/task-splitter'
import { resolveApp } from '@/lib/build/app-registry'

/**
 * Found during an overnight founder-dashboard-integrity sweep: resolveTask()
 * (task-resolver.ts) writes `stage: 'in_progress'` BEFORE any of its real I/O
 * (Gitea read/write, the LLM implement call, `vitest --coverage` — which alone
 * has a 120s RUN_TIMEOUT_MS) and only reaches a terminal `completed`/`failed`
 * write at the very end. If the nightly-loop route's process is killed
 * (its own `maxDuration`/`NIGHTLY_LOOP_BUDGET_MS`, a platform restart, an
 * uncaught crash) in that window, the task is left at `in_progress` forever —
 * runTaskResolutions() below only ever selects `stage === 'todo'` tasks, so a
 * stuck `in_progress` row is invisible to every future nightly run: never
 * retried, never marked failed. The founder's TasksPanel "In Progress" count
 * silently accumulates dead entries with no way to tell a real in-flight task
 * from an abandoned one.
 *
 * Fix: before selecting due `todo` tasks, reap any `in_progress` task whose
 * `updatedAt` (stamped fresh the moment resolveTask set it to in_progress) is
 * older than this threshold — the route's whole shared budget is ~300s, so 30
 * minutes is generous margin against a false-positive reap of a genuinely
 * still-running task, while still recovering within the same night.
 */
export const STALE_IN_PROGRESS_MS = 30 * 60 * 1000

/**
 * #2105 — the minimum amount of the nightly-loop route's shared wall-clock
 * budget that must remain before STARTING another resolveTask() call.
 * Below this, a task is deferred (left `todo`, never written to
 * `in_progress`) rather than attempted, because resolveTask() itself can
 * plausibly use up to:
 *
 *   - a Gitea issue-create + repo-read round trip (network, seconds)
 *   - a real LLM implement call (no hard timeout of its own; tens of
 *     seconds is typical, but not bounded)
 *   - a Gitea commit + PR (network, seconds)
 *   - coverage-runner's own RUN_TIMEOUT_MS (120_000ms) verify run, OR an
 *     equivalent build-check run when there's no test suite
 *   - a best-effort auto-merge + redeploy (network, seconds)
 *
 * 150s is deliberately generous relative to just the one hard-bounded step
 * (coverage-runner's 120s) so the unbounded LLM-call and network steps have
 * real headroom too — the goal is "comfortably finishes before the
 * platform's own maxDuration kill," not "exactly matches one component's
 * timeout." A single resolution that still somehow runs long is not newly
 * at risk either way; this constant only decides whether a NEW one is
 * safe to START.
 */
export const MIN_REMAINING_MS_FOR_TASK_RESOLUTION = 150_000

/**
 * PURE — whether a task is an orphaned `in_progress` row that should be
 * reaped rather than left stuck forever. See STALE_IN_PROGRESS_MS's doc.
 */
export function isStaleInProgress(
  task: Pick<BuildTask, 'stage' | 'updatedAt' | 'createdAt'>,
  now: number = Date.now(),
  thresholdMs: number = STALE_IN_PROGRESS_MS,
): boolean {
  if (task.stage !== 'in_progress') return false
  const ts = Date.parse(task.updatedAt || task.createdAt || '')
  if (!Number.isFinite(ts)) return false
  return now - ts > thresholdMs
}

/**
 * v1 scope: resolve at most this many `todo` tasks per company per nightly
 * run, for a company whose plan tier could not be resolved (the most
 * conservative case — see maxTasksForTier). Each resolution is a real LLM
 * implementation call + a real coverage run — coverage-runner.ts's own
 * RUN_TIMEOUT_MS is 120s on its own, before the implementation call and git
 * commit are even counted — so an unbounded per-company loop here risks the
 * same maxDuration exposure #404 already flagged for video generation,
 * except worse (nightly-loop iterates EVERY enrolled company's media
 * routines AND task resolutions in one process, all sharing the route's
 * single 300s maxDuration budget). Kept to 1 (not more) so a company that
 * accumulates many todo tasks still makes real forward progress every night
 * without starving every other enrolled company's run.
 *
 * #908 (epic #900): this used to be the ONLY limit, applied identically to
 * every plan tier regardless of what the founder pays for. It now serves
 * strictly as the free/hobbyist-tier ceiling AND the safe fallback a plan-
 * resolution failure degrades to (see maxTasksForTier) — kept as its own
 * exported constant (rather than folded into TASK_LIMIT_BY_TIER.hobbyist)
 * so existing callers/tests that import it directly as "today's effective
 * value" keep working unchanged.
 */
export const MAX_TASKS_PER_COMPANY_PER_RUN = 1

/** Alias for MAX_TASKS_PER_COMPANY_PER_RUN under its #908 name — the free-tier
 *  ceiling, and what a plan-resolution failure must degrade to (never
 *  unlimited, for cost control). */
export const FREE_TIER_TASK_LIMIT = MAX_TASKS_PER_COMPANY_PER_RUN

/**
 * Per-plan-tier nightly backlog-resolution ceiling (#908, epic #900).
 *
 * Keys match the normalized tier vocabulary lib/ainative/plan.ts's
 * normalizeTier() and lib/build/build-credits.ts's buildLimitForTier() use
 * elsewhere in this codebase (hobbyist/starter/pro/scale/business/
 * enterprise/cody_vcto) — picking numbers is explicitly a product decision
 * per #908's own acceptance criteria, not an engineering one; these are the
 * issue's own suggested starting values, applied consistently with the
 * existing tier model rather than inventing a new one.
 *
 * Every value is a finite, sane ceiling — including enterprise/cody_vcto.
 * "Unlimited" is deliberately NOT modeled here even for the top tiers: this
 * loop shares one route-level 300s maxDuration budget across every enrolled
 * company (see the comment on FREE_TIER_TASK_LIMIT above), and each
 * resolution is a real LLM call + coverage run, so an actually-unbounded
 * value would let one Enterprise company's backlog starve every other
 * enrolled company's nightly run — a cost/availability risk, not just a
 * cost one. A high-but-finite ceiling delivers the "unlimited in practice"
 * feel from #908's acceptance criteria without that exposure.
 */
export const TASK_LIMIT_BY_TIER: Record<string, number> = {
  hobbyist: FREE_TIER_TASK_LIMIT,
  starter: 3,
  pro: 5,
  scale: 5,
  business: 5,
  enterprise: 10,
  cody_vcto: 10,
}

/** Aliases the core plan catalog sometimes emits for the same underlying
 *  tier — kept in sync with lib/ainative/plan.ts's TIER_ALIASES so a plan id
 *  never means two different nightly-throughput limits depending on which
 *  code path resolved it. */
const TIER_ALIASES: Record<string, string> = {
  launch: 'pro',
  company: 'business',
}

/**
 * Resolve a plan tier string (as returned by resolveActivePlan()/
 * normalizeTier()) to its nightly task-resolution ceiling. PURE — no I/O, so
 * the mapping is directly unit-testable independent of how the tier was
 * obtained.
 *
 * Degrades to FREE_TIER_TASK_LIMIT — the most conservative limit, never
 * unlimited — for: a missing tier (undefined/null), an empty string (the
 * shape resolveActivePlan() returns on either confirmed-unpaid OR a failed
 * verification — see active-plan.ts's `verified` doc), and any tier string
 * this map doesn't recognize. This matters for cost control: a plan-
 * resolution hiccup must never silently grant a founder MORE nightly LLM
 * throughput than they're entitled to.
 */
export function maxTasksForTier(tier: string | null | undefined): number {
  const key = String(tier || '').toLowerCase().trim()
  const normalized = TIER_ALIASES[key] || key
  return TASK_LIMIT_BY_TIER[normalized] ?? FREE_TIER_TASK_LIMIT
}

/**
 * Resolve up to this company's plan-tier task ceiling (see maxTasksForTier)
 * `todo` tasks for a company scope, oldest first (matching a simple FIFO —
 * no priority model exists yet). `planTier` is the company's REAL,
 * server-resolved plan — never a client-sent value, per this codebase's
 * hard-learned invariant. The nightly-loop route (a cron context with no
 * founder session to borrow) resolves it via
 * lib/ainative/admin-plan-lookup.ts's fetchPlanByEmail() + normalizeTier(),
 * the same admin-scoped, offline-safe lookup lib/build/loop-backfill.ts
 * already established for this exact "no session, just an owner email"
 * situation; a request-time route with a real session would instead use
 * lib/ainative/active-plan.ts's resolveActivePlan(). Omitted or
 * unresolvable, this degrades to the free-tier limit. Returns how many were
 * attempted + how many completed successfully. Never throws.
 *
 * #1232 — `completed` means coverage-verified, decided BEFORE resolveTask()
 * attempts its own best-effort auto-merge + redeploy (#468); a merge/deploy
 * hiccup never flips a completed task back to failed, so `completed` alone
 * cannot tell an admin whether the founder's live app actually changed.
 * `merged`/`redeployed` surface resolveTask()'s own in-memory outcome for
 * that, so the nightly-loop aggregate can report real ship rate, not just
 * coverage-pass rate.
 *
 * `reaped` — how many orphaned `in_progress` rows (see isStaleInProgress's
 * doc above) were recovered to `failed` this run, before any due `todo` task
 * was attempted. A non-zero value is itself an operational signal worth
 * surfacing (it means a prior run was killed mid-resolution), not just an
 * implementation detail.
 *
 * `completedNoCoverage` — #1914: of `completed`, how many were accepted via
 * `decideOutcomeFromCoverage`'s no-test-suite path (`resolveTask()`'s
 * `testable: false`) rather than a real, run test suite — i.e. "the LLM
 * produced files and a Gitea commit succeeded," with zero functional
 * verification, before `mergeTaskPR()`'s unconditional auto-merge. Today
 * this is the common case (generated apps ship with no test script by
 * default), and nothing previously distinguished it from a genuinely
 * coverage-verified `completed` in the nightly aggregate — an admin reading
 * `tasksCompleted` alone could not tell "proven to work" from "merely
 * committed and hoped for." Observability only: does NOT change which tasks
 * get merged/redeployed — that auto-merge policy question is a human
 * decision, out of scope here.
 *
 * `deadlineMs` (#2105) — the CALLER's own real platform-kill deadline
 * (epoch ms), e.g. the nightly-loop route's `startedAt + maxDuration`. Not
 * the earlier company-admission budget that route already enforces via
 * mapWithConcurrency — this is a second, later check, because an admitted
 * company's resolution pass was previously unbounded and could still run
 * past the shared maxDuration on its own (see MIN_REMAINING_MS_FOR_TASK_
 * RESOLUTION's doc). Omitted, this function is unbounded, same as before
 * this fix — every existing caller/test keeps working unchanged.
 *
 * `deferred` — how many due `todo` tasks were skipped THIS run because too
 * little of `deadlineMs`'s budget remained to safely start them (see
 * MIN_REMAINING_MS_FOR_TASK_RESOLUTION). A deferred task is left `todo`
 * with an honest note and is NOT counted in `attempted` — it is picked up
 * for real on a future run, not lost.
 */
export async function runTaskResolutions(
  scopeKey: string,
  slug: string,
  planTier?: string | null,
  deadlineMs?: number,
): Promise<{ attempted: number; completed: number; merged: number; redeployed: number; reaped: number; completedNoCoverage: number; deferred: number }> {
  if (!scopeKey || !slug) return { attempted: 0, completed: 0, merged: 0, redeployed: 0, reaped: 0, completedNoCoverage: 0, deferred: 0 }

  const limit = maxTasksForTier(planTier)
  let attempted = 0
  let completed = 0
  let merged = 0
  let redeployed = 0
  let reaped = 0
  let completedNoCoverage = 0
  let deferred = 0
  try {
    const tasks = await listTasks(scopeKey)

    // Reap tasks orphaned by a killed/crashed resolution run — see
    // isStaleInProgress's doc above. Best-effort per task, same contract as
    // every other step in this loop: one reap failure must never block the
    // rest of this run.
    for (const t of tasks) {
      if (!isStaleInProgress(t)) continue
      try {
        await updateTask(scopeKey, t.id, {
          stage: 'failed',
          output: 'Interrupted — the automated resolution process did not finish (likely a timeout or crash). This task was not completed; it will need to be re-queued to retry.',
        })
        reaped += 1
      } catch {
        /* best-effort — a reap failure leaves the row stuck for another cycle, never throws */
      }
    }

    const todo = tasks.filter((t): t is BuildTask => t.stage === 'todo')

    // #903 (epic #900, depends on #902): a task estimated at 3/5/8 story
    // points is oversized per .ainative/RULES.MD §2 and must be SPLIT before
    // it's implemented directly — never hand one to resolveTask() while
    // it's still oversized.
    //
    // #904 — rather than just filtering these out forever (#903's original
    // scope, detection-only), decompose each one via splitTask(): a
    // best-effort LLM call that breaks it into 2-4 smaller, independently-
    // estimated sub-tasks and marks the oversized parent `completed` with an
    // honest reference to the real children. A splitter failure (the LLM
    // call, parsing, or a child persistence hiccup) leaves the parent
    // untouched — still `todo`, still oversized — for a future nightly
    // retry; it is never silently lost. Oversized tasks are never counted
    // against the tier's resolution limit (whether the split succeeds or
    // not) so they can never steal a paid tier's real nightly throughput
    // from its smaller, resolvable due tasks — matching #903's existing
    // invariant.
    const oversized = todo.filter((t) => needsSplit(t.storyPoints))
    if (oversized.length > 0) {
      // #1928 — resolved once per run (not per task) so every split child
      // this run creates gets its own Gitea issue immediately, the same as
      // resolveTask()'s own tasks below, instead of sitting invisible until
      // a future resolveTask() pass happens to reach it.
      const splitApp = await resolveApp(slug).catch(() => null)
      for (const task of oversized) {
        try {
          await splitTask(scopeKey, task, { gitOrg: splitApp?.gitOrg, slug })
        } catch {
          /* best-effort — a splitter failure (even an unexpected throw) must
           * never break the loop or lose the parent task; splitTask itself
           * already leaves the parent untouched on any internal failure. */
        }
      }
    }

    const due = todo
      .filter((t) => !needsSplit(t.storyPoints))
      .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
      .slice(0, limit)

    for (let i = 0; i < due.length; i++) {
      // #2105 — the shared nightly-loop route's `deadlineMs` is its own
      // real platform-kill time (startedAt + maxDuration), not the earlier
      // company-ADMISSION budget mapWithConcurrency already enforces in
      // route.ts. Once admitted, a company's pipeline (including this
      // function) previously ran unbounded: resolveTask() does an LLM
      // implement call, a Gitea commit+PR, and up to coverage-runner's own
      // 120s RUN_TIMEOUT_MS verify run — comfortably enough, on its own, to
      // run past whatever's left of the route's 300s maxDuration when a
      // company is admitted late in the sweep. When that happened, the
      // platform hard-killed the whole function mid-resolveTask(), leaving
      // the task stuck at the `in_progress` resolveTask() had already
      // written — invisible to every future run (which only selects
      // `todo`) until the 30-minute stale-in_progress reaper above finally
      // caught up, a day later, with a generic "timeout or crash" message
      // that gave no real signal.
      //
      // So: before STARTING another resolveTask() call, check there's
      // enough of the shared budget left to plausibly finish one — if not,
      // defer every remaining due task honestly (stage stays `todo`, never
      // written to `in_progress`) with a specific reason, rather than
      // starting one the platform would likely kill mid-flight. Omitted
      // deadlineMs (any caller/test that doesn't pass one) is unbounded,
      // same as before this fix.
      if (deadlineMs !== undefined && deadlineMs - Date.now() < MIN_REMAINING_MS_FOR_TASK_RESOLUTION) {
        for (const remaining of due.slice(i)) {
          deferred += 1
          try {
            await updateTask(scopeKey, remaining.id, {
              output: 'Deferred — insufficient time remaining in this run’s shared budget to safely attempt it; it stays queued and will be retried on a future run.',
            })
          } catch {
            /* best-effort — a failed note leaves the row untouched (still
             * `todo`), never `in_progress`, so it is still safely retryable
             * next run either way. */
          }
        }
        break
      }

      const task = due[i]
      attempted += 1
      try {
        const result = await resolveTask(scopeKey, task, slug)
        if (result.ok) completed += 1
        if (result.ok && result.testable === false) completedNoCoverage += 1
        if (result.merged) merged += 1
        if (result.redeployed) redeployed += 1
      } catch {
        /* per-task failure is non-fatal — resolveTask already records the
         * real reason on the task itself when it can; keep going either way. */
      }
    }
  } catch {
    /* listing failure is non-fatal */
  }
  return { attempted, completed, merged, redeployed, reaped, completedNoCoverage, deferred }
}
