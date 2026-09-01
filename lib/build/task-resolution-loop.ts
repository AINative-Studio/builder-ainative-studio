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
 */

import { listTasks, type BuildTask } from '@/lib/build/task-store'
import { resolveTask } from '@/lib/build/task-resolver'

/**
 * v1 scope: resolve at most this many `todo` tasks per company per nightly
 * run. Each resolution is a real LLM implementation call + a real coverage
 * run — coverage-runner.ts's own RUN_TIMEOUT_MS is 120s on its own, before
 * the implementation call and git commit are even counted — so an unbounded
 * per-company loop here risks the same maxDuration exposure #404 already
 * flagged for video generation, except worse (nightly-loop iterates EVERY
 * enrolled company's media routines AND task resolutions in one process, all
 * sharing the route's single 300s maxDuration budget). Kept to 1 (not more)
 * so a company that accumulates many todo tasks still makes real forward
 * progress every night without starving every other enrolled company's run.
 */
export const MAX_TASKS_PER_COMPANY_PER_RUN = 1

/**
 * Resolve up to MAX_TASKS_PER_COMPANY_PER_RUN `todo` tasks for a company
 * scope, oldest first (matching a simple FIFO — no priority model exists
 * yet). Returns how many were attempted + how many completed successfully.
 * Never throws.
 */
export async function runTaskResolutions(
  scopeKey: string,
  slug: string,
): Promise<{ attempted: number; completed: number }> {
  if (!scopeKey || !slug) return { attempted: 0, completed: 0 }

  let attempted = 0
  let completed = 0
  try {
    const tasks = await listTasks(scopeKey)
    const due = tasks
      .filter((t): t is BuildTask => t.stage === 'todo')
      .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
      .slice(0, MAX_TASKS_PER_COMPANY_PER_RUN)

    for (const task of due) {
      attempted += 1
      try {
        const result = await resolveTask(scopeKey, task, slug)
        if (result.ok) completed += 1
      } catch {
        /* per-task failure is non-fatal — resolveTask already records the
         * real reason on the task itself when it can; keep going either way. */
      }
    }
  } catch {
    /* listing failure is non-fatal */
  }
  return { attempted, completed }
}
