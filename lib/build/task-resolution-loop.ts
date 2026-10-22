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
 */
export async function runTaskResolutions(
  scopeKey: string,
  slug: string,
  planTier?: string | null,
): Promise<{ attempted: number; completed: number; merged: number; redeployed: number; reaped: number }> {
  if (!scopeKey || !slug) return { attempted: 0, completed: 0, merged: 0, redeployed: 0, reaped: 0 }

  const limit = maxTasksForTier(planTier)
  let attempted = 0
  let completed = 0
  let merged = 0
  let redeployed = 0
  let reaped = 0
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
    for (const task of oversized) {
      try {
        await splitTask(scopeKey, task)
      } catch {
        /* best-effort — a splitter failure (even an unexpected throw) must
         * never break the loop or lose the parent task; splitTask itself
         * already leaves the parent untouched on any internal failure. */
      }
    }

    const due = todo
      .filter((t) => !needsSplit(t.storyPoints))
      .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
      .slice(0, limit)

    for (const task of due) {
      attempted += 1
      try {
        const result = await resolveTask(scopeKey, task, slug)
        if (result.ok) completed += 1
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
  return { attempted, completed, merged, redeployed, reaped }
}
