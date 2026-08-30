/**
 * Task resolver (#374, epic #371) — wires #373's LLM implementation step,
 * task-git-sync (finally giving it its first real caller, #368), and #372's
 * coverage-gated verification runner into one honest end-to-end pipeline:
 *
 *   todo → in_progress → implement (#373) → commit to Gitea (task-git-sync)
 *        → verify coverage (#372) → completed (real PR + real coverage number)
 *                                  → failed  (real reason, no merge)
 *
 * A task NEVER moves to `completed` on a fabricated result. Every stage
 * transition is grounded in a real outcome: a real LLM response, a real git
 * commit, a real coverage percentage (or an honest "not testable" — see
 * #372's contract). On ANY failure along the way, the task moves to `failed`
 * with the real reason recorded in BuildTask.output — never silently marked
 * done, never retried indefinitely (v1 scope: single attempt, matching
 * #373's own no-retry decision).
 */

import { fetchRepoFiles } from '@/lib/git/gitea-client'
import { commitTaskWithPR } from '@/lib/git/task-git-sync'
import { resolveApp } from '@/lib/build/app-registry'
import { implementTask } from '@/lib/build/task-implementer'
import { runCoverage } from '@/lib/build/coverage-runner'
import { updateTask, type BuildTask } from '@/lib/build/task-store'

export const COVERAGE_FLOOR = 80

export interface ResolveTaskResult {
  ok: boolean
  stage: 'completed' | 'failed'
  reason?: string
  prUrl?: string
  coveragePercent?: number | null
}

// ---------------------------------------------------------------------------
// PURE LOGIC (no I/O) — unit-testable directly
// ---------------------------------------------------------------------------

/**
 * Decide the final stage + honest output message from a coverage-runner
 * result, mirroring core's issue_resolution_loop.py: a genuinely untestable
 * story (no test suite exists) is accepted on a successful implement+commit
 * rather than gated on a number that can't exist — never fabricates a
 * coverage pass, but also never blocks a real change just because the
 * generated app has no tests yet. PURE.
 */
export function decideOutcomeFromCoverage(
  coverage: { coveragePercent: number | null; testable: boolean; passed: boolean; reason?: string },
  floor: number = COVERAGE_FLOOR,
): { stage: 'completed' | 'failed'; reason?: string } {
  if (!coverage.testable) {
    // No test suite for this app yet — not testable via code tests, so this
    // story is accepted on a successful implement+commit rather than blocked
    // on a number that can never exist. Matches #372's own contract note.
    return { stage: 'completed', reason: 'No test suite exists for this app yet — accepted on implementation, not coverage-gated.' }
  }
  if (!coverage.passed) {
    return { stage: 'failed', reason: coverage.reason || 'Test run did not pass.' }
  }
  if (coverage.coveragePercent === null) {
    // Tests passed but coverage genuinely could not be measured — never
    // fabricate a number to force a pass or fail; be honest that this
    // specific gate couldn't run, but the tests DID pass.
    return { stage: 'failed', reason: 'Tests passed but coverage could not be measured — cannot verify the 80% floor.' }
  }
  if (coverage.coveragePercent < floor) {
    return { stage: 'failed', reason: `Coverage ${coverage.coveragePercent}% is below the ${floor}% floor.` }
  }
  return { stage: 'completed', reason: `Coverage ${coverage.coveragePercent}% meets the ${floor}% floor.` }
}

// ---------------------------------------------------------------------------
// I/O — the real end-to-end pipeline
// ---------------------------------------------------------------------------

/**
 * Resolve one backlog task end-to-end. Reads the company's CURRENT Gitea
 * repo state, has the LLM implement the story, commits the result (with a
 * PR), coverage-verifies it, and updates the task's durable stage — honestly,
 * at every step. Never throws; every failure path returns a real ok:false
 * result AND records it via updateTask so the founder sees the real reason.
 */
export async function resolveTask(scopeKey: string, task: BuildTask, slug: string): Promise<ResolveTaskResult> {
  const fail = async (reason: string): Promise<ResolveTaskResult> => {
    await updateTask(scopeKey, task.id, { stage: 'failed', output: reason })
    return { ok: false, stage: 'failed', reason }
  }

  await updateTask(scopeKey, task.id, { stage: 'in_progress' })

  const app = await resolveApp(slug)
  if (!app?.gitOrg) {
    return fail('Company is not git-provisioned yet — cannot resolve tasks without a Gitea repo.')
  }

  const existingFiles = await fetchRepoFiles(app.gitOrg, slug)
  if (existingFiles === null) {
    return fail('Could not read the company’s current repo state from Gitea.')
  }

  const implemented = await implementTask({ title: task.title, detail: task.detail }, existingFiles)
  if (!implemented.ok || !implemented.files) {
    return fail(implemented.reason || 'Implementation step failed with no reason given.')
  }

  const gitResult = await commitTaskWithPR({
    taskId: task.id,
    slug,
    files: implemented.files,
    title: task.title,
  })
  if (!gitResult.ok) {
    return fail(`Could not commit the implementation: ${gitResult.reason || 'unknown git-sync failure'}.`)
  }

  // Merge the changed files over the existing tree so coverage runs against
  // the FULL app state, not just the diff (a changed component might import
  // an unchanged one — the test suite needs the whole picture).
  const fullTree = { ...existingFiles, ...implemented.files }
  const coverage = await runCoverage(fullTree)
  const outcome = decideOutcomeFromCoverage(coverage)

  const output = outcome.stage === 'completed'
    ? `${gitResult.prUrl ? `PR: ${gitResult.prUrl}. ` : ''}${outcome.reason || ''}`.trim()
    : outcome.reason || 'Coverage verification failed.'

  await updateTask(scopeKey, task.id, { stage: outcome.stage, output })

  return {
    ok: outcome.stage === 'completed',
    stage: outcome.stage,
    reason: outcome.stage === 'failed' ? outcome.reason : undefined,
    prUrl: gitResult.prUrl,
    coveragePercent: coverage.coveragePercent,
  }
}
