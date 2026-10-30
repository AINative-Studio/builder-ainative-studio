/**
 * Task resolver (#374, epic #371) — wires #373's LLM implementation step,
 * task-git-sync (finally giving it its first real caller, #368), and #372's
 * coverage-gated verification runner into one honest end-to-end pipeline:
 *
 *   todo → in_progress → implement (#373) → commit to Gitea (task-git-sync)
 *        → verify coverage (#372) → completed (real PR, auto-merged, redeployed)
 *                                  → failed  (real reason, no merge)
 *
 * A task NEVER moves to `completed` on a fabricated result. Every stage
 * transition is grounded in a real outcome: a real LLM response, a real git
 * commit, a real coverage percentage (or an honest "not testable" — see
 * #372's contract). On ANY failure along the way, the task moves to `failed`
 * with the real reason recorded in BuildTask.output — never silently marked
 * done, never retried indefinitely (v1 scope: single attempt, matching
 * #373's own no-retry decision).
 *
 * #468 — auto-merge on completion. Before this, `commitTaskWithPR` opened a
 * PR but NOTHING in the codebase ever merged it, so a `completed` task's real,
 * coverage-verified work sat on an unmerged branch forever — the nightly loop
 * could report a task done while the founder's live app never changed. Per
 * the owner's explicit decision ("auto merge always, and keep the loop
 * going"), a `completed` outcome now squash-merges the PR into `main` and, if
 * Railway deploy is enabled for this environment, triggers a real redeploy so
 * the change actually reaches the founder's live app — not just their Gitea
 * history. Both steps are best-effort AFTER the task is already durably
 * `completed`: a merge or deploy hiccup downgrades the founder's visibility
 * (the PR/commit stays real and inspectable) but never flips a genuinely
 * coverage-verified task back to `failed`.
 *
 * #905 — "No Code Without An Issue" (.ainative/ISSUE_TRACKING_ENFORCEMENT.md's
 * Golden Rule). Before this, a task went straight from `build_tasks` row to
 * LLM-implementation to a Gitea PR — no issue was ever opened on the
 * company's own Gitea repo first. Now, before `implementTask` runs,
 * resolveTask() opens a real issue (via the existing createIssue() client
 * method added by #744) using an honest body (problem/context + acceptance
 * criteria + estimate, per #906) and persists the real issue number on the
 * task. Best-effort, matching this pipeline's existing pattern: a creation
 * failure logs and proceeds — it never blocks or fails the resolver. Not
 * attempted again for a task that already has one (no duplicate issues on a
 * retried/resumed task).
 *
 * #1483 — not every non-success is a failure. The pipeline's first step is a
 * registry lookup, and that read can fail transiently; collapsing "couldn't
 * check" into `failed` permanently burned real, legitimate tasks on already-
 * git-provisioned companies with a flatly wrong reason ("not git-provisioned
 * yet"), and nothing ever retried them. An inconclusive lookup now returns
 * the task to `todo` with a third, non-terminal `stage: 'deferred'` outcome —
 * the only state lib/build/task-resolution-loop.ts's existing retry selection
 * actually honors. A CONFIRMED miss (no such company) still fails terminally.
 *
 * #1700 — #1483 only split "couldn't check" from "checked, and the company
 * doesn't exist." It still collapsed a THIRD case into the same terminal
 * fail(): a real, existing company that just hasn't been git-provisioned
 * YET (e.g. chat-ws's obedience-gate createTask() fires for an anonymous
 * session with no Gitea org at all). That's a timing race, not a confirmed-
 * permanent miss — the company can get a gitOrg later once claimed/upgraded,
 * but the terminal `failed` stage this used to land on is never re-picked,
 * so the gap it found was lost for good. Only "no such company" (entry is
 * null/soft-deleted) is treated as the real terminal miss now; an existing
 * company with no gitOrg yet defers instead, same as an unverified read.
 *
 * #906 — the issue body's "## Estimate" section now carries the task's REAL
 * Fibonacci storyPoints/estimateRationale (populated at creation time by
 * #902's lib/build/story-estimator.ts), matching
 * ISSUE_TRACKING_ENFORCEMENT.md's required template section. A task with no
 * estimate yet (`storyPoints: null`) renders an honest "Unestimated" state —
 * see buildTaskIssueBody() below.
 */

import { fetchRepoFiles, mergeTaskPR, createIssue } from '@/lib/git/gitea-client'
import { commitTaskWithPR } from '@/lib/git/task-git-sync'
import { resolveAppVerified, setAppRailwayService } from '@/lib/build/app-registry'
import { implementTask } from '@/lib/build/task-implementer'
import { runCoverage } from '@/lib/build/coverage-runner'
import { updateTask, type BuildTask } from '@/lib/build/task-store'
import { deployCompanyFromGitea, companyDeployEnabled } from '@/lib/build/company-deploy'
import { BUILDER_WORKSPACE_ID } from '@/lib/build/instant-db'
import { startDecisionTrace, addTraceStep, completeDecisionTrace } from '@/lib/agent/zeromemory'
import { reportDeploymentHealthStage, type DeploymentHealthStage as DeploymentHealthStageName } from '@/lib/build/deployment-health'

export const COVERAGE_FLOOR = 80

export interface ResolveTaskResult {
  ok: boolean
  /**
   * The task's REAL durable stage after this pass.
   *
   * #1483 — `'deferred'` is the third, non-terminal outcome: this pass could
   * not determine anything (the registry read itself failed), so the task was
   * NOT resolved and NOT failed — it was handed back to the backlog as `todo`
   * so the next pass genuinely retries it. `ok` is false (nothing shipped),
   * but unlike `'failed'` it carries no verdict about the work itself.
   */
  stage: 'completed' | 'failed' | 'deferred'
  reason?: string
  prUrl?: string
  coveragePercent?: number | null
  /** #468 — whether the PR was auto-merged to main. Always false for a failed task. */
  merged?: boolean
  /** #468 — whether a real redeploy was triggered after a successful merge. */
  redeployed?: boolean
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
  coverage: { coveragePercent: number | null; testable: boolean; passed: boolean; reason?: string; sandboxRefused?: boolean },
  floor: number = COVERAGE_FLOOR,
): { stage: 'completed' | 'failed'; reason?: string } {
  if (coverage.sandboxRefused) {
    // #917: testable:false here means "we refused to run untrusted code
    // unsandboxed," NOT "this app has no tests yet" — must never be treated
    // as the benign case below, or a future E2B misconfiguration would
    // silently merge unverified code while looking like an honest decision.
    return { stage: 'failed', reason: coverage.reason || 'Coverage could not be verified — sandboxed execution was unavailable.' }
  }
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

/**
 * Render the body of the Gitea issue opened before a task is implemented
 * (#905). Follows the shape of `.ainative/ISSUE_TRACKING_ENFORCEMENT.md`'s
 * template — problem/context, acceptance criteria, and (#906) the required
 * "## Estimate" section carrying the task's REAL Fibonacci story-point size
 * + rationale (lib/build/story-estimator.ts via #902) — without fabricating
 * the parts of that template still out of scope: issue↔PR linkage beyond a
 * plain note is #907's scope. PURE.
 *
 * #906 — a task that has no estimate yet (`storyPoints: null`: a pre-#902
 * row, or this task's own estimation call failed — see story-estimator.ts's
 * BEST-EFFORT contract) renders an honest "Unestimated" state rather than
 * ever inventing a Fibonacci number. `storyPoints` is checked with a strict
 * `=== null` test (not a falsy check) so the real, valid `0` estimate (a
 * trivial task) renders as `0`, not as unestimated.
 */
export function buildTaskIssueBody(task: { title: string; detail?: string; storyPoints?: number | null; estimateRationale?: string | null }): string {
  const context = task.detail?.trim() || task.title
  const hasEstimate = task.storyPoints !== null && task.storyPoints !== undefined
  const estimateLines = hasEstimate
    ? [
        `**Story Points:** ${task.storyPoints}`,
        `**Rationale:** ${task.estimateRationale?.trim() || 'No rationale recorded.'}`,
      ]
    : [`**Story Points:** Unestimated`, `**Rationale:** Not yet estimated.`]
  return [
    `## Problem/Context`,
    `**${task.title}**`,
    '',
    context,
    '',
    '## Acceptance Criteria',
    '- [ ] The described change is implemented and committed',
    '- [ ] Real test coverage on changed files meets the project floor',
    '',
    '## Estimate',
    ...estimateLines,
    '',
    `_Opened automatically before implementation begins, per .ainative/ISSUE_TRACKING_ENFORCEMENT.md's "No Code Without An Issue" rule (#905). Issue↔PR linkage is tracked separately — see #907._`,
  ].join('\n')
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
  // Decision Trace (builder#685) — a real, queryable record of THIS task's
  // reasoning, connecting #670's backlog/BuildTask rows to the actual work
  // an agent did and why. Best-effort throughout: a trace-call failure
  // (traceId stays null) never affects the real resolution outcome below —
  // every addTraceStep/completeDecisionTrace call is itself a no-op when
  // traceId is null.
  const traceId = await startDecisionTrace(`Resolve backlog task: ${task.title}`, scopeKey)

  const fail = async (reason: string, healthStage: DeploymentHealthStageName = 'implement'): Promise<ResolveTaskResult> => {
    await updateTask(scopeKey, task.id, { stage: 'failed', output: reason })
    if (traceId) await completeDecisionTrace(traceId, reason, false)
    await reportDeploymentHealthStage('builder_company_task', task.id, healthStage, 'failed', reason)
    return { ok: false, stage: 'failed', reason }
  }

  /**
   * #1483 — hand a task back to the backlog instead of burning it.
   *
   * `fail()` above is terminal by design: nothing in this codebase ever
   * re-picks a `failed` task. runTaskResolutions() (lib/build/
   * task-resolution-loop.ts) selects ONLY `stage === 'todo'` rows, and its
   * stale-`in_progress` reaper moves an abandoned row to `failed` too — so
   * neither `failed` NOR the `in_progress` this function already wrote below
   * leaves a task eligible for a real retry. The only state the existing
   * retry mechanism actually honors is `todo`.
   *
   * So for an INCONCLUSIVE pass — "we couldn't check," not "we checked and
   * the answer is no" — the honest move is to undo this run's own
   * `in_progress` write and return the task to `todo`, where the next
   * nightly run will attempt it again for real. No new retry mechanism is
   * invented; this just stops feeding a non-decision into the terminal one.
   */
  const defer = async (reason: string): Promise<ResolveTaskResult> => {
    // Put the row back the way we found it. A failed write here is survivable:
    // the row stays `in_progress` and the loop's 30-minute reaper eventually
    // recovers it — strictly better than this pass forcing a `failed` verdict.
    await updateTask(scopeKey, task.id, { stage: 'todo', output: reason })
    // Closed as NOT successful (nothing shipped) but deliberately NOT reported
    // as a failed deployment-health stage: no implement/commit/coverage stage
    // ran, so claiming one failed would be fabricating a verdict.
    if (traceId) await completeDecisionTrace(traceId, reason, false)
    return { ok: false, stage: 'deferred', reason }
  }

  await updateTask(scopeKey, task.id, { stage: 'in_progress' })

  // #1483 — resolveApp()'s plain `null`/missing-gitOrg return collapsed
  // "this company genuinely has no Gitea org yet" with "the registry read
  // itself failed," and fed both into the terminal fail() above. That meant a
  // transient ZeroDB hiccup permanently marked a real, legitimate task on an
  // already-git-provisioned company as `failed` with a flatly wrong reason —
  // real work lost, never retried. Same #832-class distinction every other
  // call site in this sweep now draws.
  const { entry: app, verified } = await resolveAppVerified(slug).catch(
    () => ({ entry: null as Awaited<ReturnType<typeof resolveAppVerified>>['entry'], verified: false }),
  )
  if (!verified) {
    return defer(
      'Could not confirm this company’s git provisioning just now (a temporary problem reading the registry) — the task was left queued and will be retried.',
    )
  }
  if (!app) {
    // A CONFIRMED miss: the registry really was read, and no company with
    // this slug exists (or it was soft-deleted). Nothing will ever
    // provision a Gitea org for it — a genuine, permanent failure.
    return fail('Company no longer exists — cannot resolve tasks for a deleted or unknown company.')
  }
  if (!app.gitOrg) {
    // #1700 — "not git-provisioned YET" is not the same confirmed-permanent
    // miss as the company not existing at all. A real, existing company
    // (e.g. one still on an anonymous session, per chat-ws's createTask()
    // call) can get its Gitea org only later, once claimed/upgraded. Failing
    // this terminally burns the task forever (fail() is never re-picked —
    // see the defer() doc above), even though the gap it found is still
    // real and still worth the founder seeing once provisioning catches up.
    // Defer instead, so a later nightly run retries once gitOrg is set.
    return defer(
      'This company is not git-provisioned yet — the task was left queued and will be retried once it is.',
    )
  }

  // #905 — open a real tracked issue on the company's own Gitea repo BEFORE
  // implementation begins. Best-effort and never attempted twice: a task
  // that already has a giteaIssueNumber (e.g. a resumed/retried resolution)
  // skips this step entirely rather than opening a duplicate. A creation
  // failure (network, misconfiguration) logs and proceeds — it must never
  // block the resolver, matching this pipeline's existing best-effort style.
  //
  // #907 — `issueNumber` captures whichever issue number ends up governing
  // THIS resolution (freshly created here, or already on the task from a
  // resumed/retried run) so the branch/commit/PR step below can reference it.
  // `task.giteaIssueNumber` itself is never reassigned after a fresh
  // createIssue call (the `task` param is a snapshot from before this
  // function ran), so reading it directly after this block would silently
  // lose a just-created issue number on every first-time resolution.
  let issueNumber: number | null | undefined = task.giteaIssueNumber
  if (issueNumber == null) {
    try {
      const issueResult = await createIssue(app.gitOrg, slug, task.title, buildTaskIssueBody(task))
      if (issueResult.ok && issueResult.issueNumber) {
        issueNumber = issueResult.issueNumber
        await updateTask(scopeKey, task.id, { giteaIssueNumber: issueResult.issueNumber })
        if (traceId) {
          await addTraceStep(traceId, `Opened a real Gitea issue before implementation: #${issueResult.issueNumber}.`, 'open_issue')
        }
      } else {
        console.warn('[task-resolver] createIssue did not succeed, proceeding without an issue:', issueResult.reason)
      }
    } catch (e) {
      console.warn('[task-resolver] createIssue threw, proceeding without an issue:', (e as Error)?.message || e)
    }
  }

  const existingFiles = await fetchRepoFiles(app.gitOrg, slug)
  if (existingFiles === null) {
    return fail('Could not read the company’s current repo state from Gitea.')
  }

  if (traceId) {
    await addTraceStep(
      traceId,
      `Read the company's current Gitea repo (${Object.keys(existingFiles).length} files) to ground the implementation in the real, current app state.`,
      'read_repo',
    )
  }

  const implemented = await implementTask({ title: task.title, detail: task.detail }, existingFiles)
  if (!implemented.ok || !implemented.files) {
    return fail(implemented.reason || 'Implementation step failed with no reason given.')
  }
  await reportDeploymentHealthStage(
    'builder_company_task',
    task.id,
    'implement',
    'ok',
    `LLM produced ${Object.keys(implemented.files).length} changed/new file(s).`,
  )

  if (traceId) {
    await addTraceStep(
      traceId,
      `Implemented "${task.title}" — LLM produced ${Object.keys(implemented.files).length} changed/new file(s).`,
      'implement',
    )
  }

  const gitResult = await commitTaskWithPR({
    taskId: task.id,
    slug,
    files: implemented.files,
    title: task.title,
    // #907 — thread the real issue number (opened above, #905) through so the
    // branch name, commit message (`Refs #N`), and PR body (`Closes #N`) all
    // reference it. `issueNumber` stays null/undefined for a pre-#905 row or
    // a failed issue-open attempt, in which case commitTaskWithPR/
    // task-git-sync.ts fall back to today's behavior.
    giteaIssueNumber: issueNumber,
  })
  if (!gitResult.ok) {
    return fail(`Could not commit the implementation: ${gitResult.reason || 'unknown git-sync failure'}.`, 'commit')
  }
  await reportDeploymentHealthStage(
    'builder_company_task',
    task.id,
    'commit',
    'ok',
    'Committed the implementation and opened a real PR.',
    gitResult.prUrl ? { prUrl: gitResult.prUrl } : undefined,
  )

  if (traceId) {
    await addTraceStep(traceId, `Committed the implementation and opened a real PR.`, 'commit_pr', gitResult.prUrl ? [gitResult.prUrl] : undefined)
  }

  // Merge the changed files over the existing tree so coverage runs against
  // the FULL app state, not just the diff (a changed component might import
  // an unchanged one — the test suite needs the whole picture).
  const fullTree = { ...existingFiles, ...implemented.files }
  const coverage = await runCoverage(fullTree)
  const outcome = decideOutcomeFromCoverage(coverage)

  await reportDeploymentHealthStage(
    'builder_company_task',
    task.id,
    'coverage',
    outcome.stage === 'completed' ? 'ok' : 'failed',
    outcome.reason,
    { coveragePercent: coverage.coveragePercent, testable: coverage.testable },
  )

  if (traceId) {
    await addTraceStep(
      traceId,
      `Ran real coverage verification: ${coverage.coveragePercent ?? 'not testable'}${typeof coverage.coveragePercent === 'number' ? '%' : ''} — decided stage '${outcome.stage}'.`,
      'verify_coverage',
    )
  }

  // #468 — auto-merge + redeploy on a genuinely completed, coverage-verified
  // task. Best-effort: a merge/deploy hiccup must never downgrade an already
  // coverage-verified `completed` outcome to `failed` — the real work and its
  // PR remain valid and inspectable either way, this just decides whether the
  // founder's LIVE app reflects it automatically or needs a manual merge.
  let merged = false
  let redeployed = false
  if (outcome.stage === 'completed' && gitResult.prNumber) {
    merged = await mergeTaskPR(app.gitOrg, slug, gitResult.prNumber).catch(() => false)
    await reportDeploymentHealthStage(
      'builder_company_task',
      task.id,
      'merge',
      merged ? 'ok' : 'skipped',
      merged ? undefined : 'Could not auto-merge — needs manual review.',
      gitResult.prUrl ? { prUrl: gitResult.prUrl } : undefined,
    )
    if (merged && companyDeployEnabled()) {
      try {
        const alreadyProvisioned = Boolean(app.railwayServiceId)
        const dep = await deployCompanyFromGitea(app.workspaceId || BUILDER_WORKSPACE_ID, slug, alreadyProvisioned)
        if (dep.ok && dep.serviceName) {
          await setAppRailwayService(slug, { railwayServiceId: dep.serviceName, deployUrl: dep.url }).catch(() => {})
          redeployed = true
        }
        await reportDeploymentHealthStage(
          'builder_company_task',
          task.id,
          'deploy',
          redeployed ? 'ok' : 'failed',
          redeployed ? undefined : 'Redeploy did not report a service name.',
        )
      } catch {
        /* best-effort — a redeploy hiccup never downgrades a completed task */
        await reportDeploymentHealthStage('builder_company_task', task.id, 'deploy', 'failed', 'Redeploy threw an error.')
      }
    } else if (merged) {
      await reportDeploymentHealthStage('builder_company_task', task.id, 'deploy', 'skipped', 'Railway deploy is not enabled for this environment.')
    }
  }

  const mergeNote = outcome.stage === 'completed'
    ? merged
      ? redeployed ? ' Merged to main and redeployed.' : ' Merged to main.'
      : ' PR left open — could not auto-merge (needs manual review).'
    : ''
  const output = outcome.stage === 'completed'
    ? `${gitResult.prUrl ? `PR: ${gitResult.prUrl}. ` : ''}${outcome.reason || ''}${mergeNote}`.trim()
    : outcome.reason || 'Coverage verification failed.'

  // #1086: persist the REAL task branch onto the row so the Gitea webhook's
  // reverse sync (lib/git/task-sync-from-git.ts) can match this exact row by
  // branch once the PR's state changes later (e.g. a human reviews and
  // merges/closes it after a 'failed' coverage outcome here, or re-opens one
  // this auto-merge attempt above left open) — without this, every such
  // later webhook event would see no matching row and create a duplicate
  // synthetic one instead of updating this real task.
  await updateTask(scopeKey, task.id, {
    stage: outcome.stage,
    output,
    giteaBranch: gitResult.branchName || undefined,
  })

  if (traceId) {
    await completeDecisionTrace(traceId, output, outcome.stage === 'completed')
  }

  return {
    ok: outcome.stage === 'completed',
    stage: outcome.stage,
    reason: outcome.stage === 'failed' ? outcome.reason : undefined,
    prUrl: gitResult.prUrl,
    coveragePercent: coverage.coveragePercent,
    merged,
    redeployed,
  }
}
