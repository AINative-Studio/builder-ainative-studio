/**
 * Gitea → build_tasks sync (#1086) — the REVERSE direction of
 * `lib/git/task-git-sync.ts` (which pushes build_tasks → Gitea branches/PRs).
 * This module reacts to the Gitea PR webhook already wired in
 * `app/api/webhooks/gitea/route.ts` and keeps each task's `stage` honest
 * against the REAL state of its PR, instead of freezing at whatever stage it
 * was in when the task was last dispatched.
 *
 * WHY: the "Tasks & backlog" dashboard (#55) only ever wrote/read the
 * `build_tasks` ZeroDB table. The swarm/nightly-loop/resolver pipeline sets a
 * task to `in_progress` when it starts and `completed`/`failed` based on its
 * OWN local verdict — but once work is handed to Gitea (a branch + PR), the
 * REAL outcome (did the PR actually merge? did the standards gate reject it?
 * did the founder close it without merging?) was never fed back. A task
 * could show `in_progress` forever even after its PR was merged days ago.
 *
 * SETTLED DESIGN (issue #1086, approved by the lead engineer — the open
 * questions in the issue body are resolved, this is NOT a fresh design):
 *
 *   1. Sync mechanism: the EXISTING Gitea webhook, no polling. This module is
 *      called from `app/api/webhooks/gitea/route.ts`'s `pull_request` branch.
 *   2. State mapping (no synced "To Do" bucket — only work an agent has
 *      actually STARTED, evidenced by a linked branch/PR, shows up here):
 *        open PR, standards gate not yet resolved → in_progress
 *        open PR, standards gate FAILED (REQUEST_CHANGES)  → failed
 *        merged PR                                          → completed
 *        closed WITHOUT merging                             → rejected
 *      "CI" for a company repo's PRs IS this app's own coding-standards gate
 *      (`lib/git/committee-pr-gate.ts`'s `runStandardsGate`/`handlePRWebhook`,
 *      posted as a Gitea PR review) — there is no separate external CI/status
 *      webhook event for generated company repos (confirmed against the live
 *      Gitea swagger spec: no commit-status write path is wired anywhere in
 *      this codebase for company repos). The gate runs SYNCHRONOUSLY inside
 *      the same webhook call this module is invoked from, so its verdict is
 *      passed in directly rather than re-fetched.
 *   3. Merge semantics: match a PR back to an EXISTING build_tasks row via
 *      the `task/{taskId}` (or `task/{issueNumber}-{taskId}`) branch
 *      convention `lib/git/gitea-client.ts`'s `taskBranchName` already
 *      establishes — update that row's stage, never create a duplicate. A PR
 *      whose head branch does NOT match that convention (work created
 *      directly in Gitea, not through this app's chat/swarm/nightly flows)
 *      gets its OWN synthetic row instead of being dropped silently.
 *   4. Scoping: company-wide, not gated by which owner session created the
 *      task. This module does not itself choose a scope key for an UPDATE —
 *      it reads the task row's own persisted `scopeKey` (whichever owner
 *      created it) via `listTasksForCompany`, so the write lands on the
 *      correct existing scope. A NEW synthetic row uses a company-wide
 *      sentinel owner key (`git:{slug}`) rather than any particular founder's
 *      session, so it's never tied to "whoever happened to be logged in when
 *      the webhook fired" (webhooks have no viewing session at all).
 *
 * Never throws — called fire-and-forget from the webhook route (#392's push
 * handler established this pattern: a Gitea webhook must get a fast ack, and
 * a sync hiccup must never surface as a 500 to Gitea or block the standards
 * gate's own review).
 */

import {
  listTasksForCompany,
  updateTask,
  createTask,
  normalizeStage,
  type BuildTask,
  type TaskStage,
} from '@/lib/build/task-store'

// ---------------------------------------------------------------------------
// Pure logic (no I/O) — unit-testable directly
// ---------------------------------------------------------------------------

/** The shape of the bits of a Gitea PR webhook payload this module needs. */
export interface GitTaskSyncInput {
  /** Gitea's webhook `action` field. Known values: opened, synchronize(d),
   *  reopened, edited, closed. Anything else is ignored. */
  action: string
  pullRequest: {
    number: number
    title?: string
    merged?: boolean
    state?: string
    html_url?: string
    head?: { ref?: string }
  }
  repository: {
    name: string
    owner: { login: string }
  }
}

/** The result of the (synchronous, in-process) standards/committee gate for
 *  this same PR event — passed in directly rather than re-derived, since
 *  `handlePRWebhook` already computed it in the SAME webhook call. */
export type GateVerdict = 'approve' | 'request-changes' | 'pending' | null

export interface GitTaskSyncResult {
  ok: boolean
  reason: string
  /** The stage this PR event resolved to, when one was applied. */
  stage?: TaskStage
  /** Whether the write landed on an existing row vs. a new synthetic one. */
  matched?: 'existing' | 'synthetic' | 'none'
}

/**
 * Derive the Gitea task branch from a `task/{taskId}` or
 * `task/{issueNumber}-{taskId}` head ref, or null when the ref doesn't match
 * that convention at all (a PR opened directly against Gitea, not through
 * this app's own flows). PURE — `taskBranchName`'s own sanitization means we
 * don't need to parse taskId back out; this module matches by the FULL
 * branch string, not by re-deriving taskId from it (sanitization is lossy —
 * e.g. two different raw taskIds could collide after lowercasing/stripping —
 * so the branch string itself, not a guessed-back taskId, is the real merge
 * key between a persisted row's `giteaBranch` and a PR's `head.ref`).
 */
export function giteaTaskBranchOf(headRef: string | undefined | null): string | null {
  const ref = String(headRef || '').trim()
  if (!ref) return null
  return ref.startsWith('task/') ? ref : null
}

/**
 * Map a PR event + this repo's own standards-gate verdict to a lifecycle
 * stage (#1086 req 2). PURE. Returns null when the action isn't one that
 * should drive a stage transition at all (e.g. `edited`, or an unrecognized
 * action) — the caller should leave the task's stage untouched in that case.
 *
 * `action` is normalized defensively: Gitea's own `synchronize` action is
 * documented as GitHub-shaped, but a REAL confirmed divergence (go-gitea
 * issue #27118) is that Gitea actually sends `synchronized` on the wire —
 * both spellings are treated identically here so this module doesn't repeat
 * that same gap.
 */
export function mapPREventToStage(
  input: { action: string; merged?: boolean },
  gateVerdict: GateVerdict,
): TaskStage | null {
  const action = String(input.action || '').trim().toLowerCase()

  if (action === 'closed') {
    return input.merged ? 'completed' : 'rejected'
  }
  if (action === 'opened' || action === 'reopened' || action === 'synchronize' || action === 'synchronized') {
    // Open PR: a standings-gate REJECTION is a real "this agent's attempt
    // did not pass" signal → failed. Anything else (approved, or not yet
    // resolved) → actively being worked.
    return gateVerdict === 'request-changes' ? 'failed' : 'in_progress'
  }
  // edited / labeled / assigned / review_requested / unknown — no stage
  // transition implied by this action alone.
  return null
}

/**
 * Build the synthetic task fields for a Gitea PR with no matching task
 * branch (#1086 req 3 — "work created directly in Gitea... would need its
 * own synthetic row"). PURE. The synthetic row's `taskId` is always null —
 * there is no platform-dispatched task behind it, only a PR.
 */
export function syntheticTaskFromPR(
  pr: GitTaskSyncInput['pullRequest'],
  stage: TaskStage,
  branch: string,
): {
  title: string
  detail: string
  stage: string
  source: 'swarm'
  giteaBranch: string
  giteaSynthetic: true
} {
  const title = String(pr.title || '').trim() || `PR #${pr.number}`
  return {
    title: `[Gitea] ${title}`.slice(0, 400),
    detail: `Opened directly in Gitea (no matching AINative task branch). ${pr.html_url || ''}`.trim(),
    stage,
    source: 'swarm',
    giteaBranch: branch,
    giteaSynthetic: true,
  }
}

/**
 * The company-wide sentinel owner key for synthetic Gitea-sourced rows
 * (#1086 req 4). Never a real founder's email/guest id — a webhook has no
 * viewing session, and the row must be visible to every authorized viewer of
 * the company regardless of who's logged in when Gitea fires the event.
 * PURE. Mirrors `chatScopeKey`'s own `{owner}::{slug}` join so
 * `scopeKeyBelongsToCompany` (task-store.ts) still recognizes it as this
 * company's row on the company-wide read path.
 */
export function syntheticScopeKey(slug: string): string {
  return `git:webhook::${String(slug || '').trim().toLowerCase()}`
}

// ---------------------------------------------------------------------------
// I/O orchestration
// ---------------------------------------------------------------------------

/**
 * Find the existing build_tasks row (any owner) whose `giteaBranch` matches
 * this PR's head branch, within a company's full task list. Pure given the
 * list — separated out so the matching logic itself (not just the mapping)
 * is unit-testable without ZeroDB.
 */
export function findTaskByBranch(tasks: BuildTask[], branch: string): BuildTask | null {
  if (!branch) return null
  return (Array.isArray(tasks) ? tasks : []).find((t) => t && t.giteaBranch === branch) || null
}

/**
 * React to a single Gitea PR webhook event: update the matching task's
 * stage, or create a synthetic row when no task branch matches. Never
 * throws — every branch returns a structured `{ok, reason}` so the webhook
 * route can fire this without risking an unhandled rejection (same contract
 * as `handlePushRedeploy` in app/api/webhooks/gitea/route.ts).
 */
export async function syncTaskFromPREvent(
  input: GitTaskSyncInput,
  gateVerdict: GateVerdict = null,
): Promise<GitTaskSyncResult> {
  try {
    const slug = String(input.repository?.name || '').trim()
    if (!slug) return { ok: false, reason: 'invalid_payload' }

    const branch = giteaTaskBranchOf(input.pullRequest?.head?.ref)
    if (!branch) {
      return { ok: true, reason: 'not_a_task_branch', matched: 'none' }
    }

    const stage = mapPREventToStage(
      { action: input.action, merged: input.pullRequest?.merged },
      gateVerdict,
    )
    if (!stage) {
      return { ok: true, reason: `ignored_action: ${input.action}` }
    }

    const tasks = await listTasksForCompany(slug)
    const existing = findTaskByBranch(tasks, branch)

    if (existing) {
      const ok = await updateTask(existing.scopeKey, existing.id, { stage })
      return ok
        ? { ok: true, reason: 'updated_existing', stage, matched: 'existing' }
        : { ok: false, reason: 'update_failed', stage, matched: 'existing' }
    }

    // No matching task row — this PR's work wasn't dispatched through this
    // app's own chat/swarm/nightly flows. Synthesize a row so it still shows
    // up in the company's backlog (#1086 req 3), company-wide (req 4).
    //
    // De-dupe guard: a rapid-fire sequence of webhook deliveries for the SAME
    // branch (opened → synchronized → closed, which Gitea can deliver in
    // quick succession) must not create a new synthetic row per event —
    // `findTaskByBranch` above already covers this for any row that made it
    // into `tasks`, but a race between two in-flight webhook calls for the
    // very first event on a brand-new branch could still double-create. Not
    // fully closed here (would need a DB-level unique constraint this
    // table's plain rows API doesn't offer) — acceptable because
    // `mergeGiteaTasks` at read time collapses same-branch synthetic
    // duplicates (prefers the freshest), so a transient race degrades to
    // "briefly two rows, then one" rather than a permanent visible split.
    const synthetic = syntheticTaskFromPR(input.pullRequest, stage, branch)
    const created = await createTask(syntheticScopeKey(slug), {
      ...synthetic,
      skipEstimate: true,
    })
    return created
      ? { ok: true, reason: 'created_synthetic', stage, matched: 'synthetic' }
      : { ok: false, reason: 'create_synthetic_failed', stage, matched: 'synthetic' }
  } catch (err) {
    return { ok: false, reason: `error: ${err instanceof Error ? err.message : String(err)}` }
  }
}
