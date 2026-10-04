/**
 * Task → Git synchronization (#356 · GIT-3). Each Cody/swarm build_task maps to a
 * branch + commit (optionally a PR) in the company repo, enabling:
 *   - diff-per-task: each task's changes are isolated to its branch
 *   - revertable: founders can revert a single task without affecting others
 *   - blame-per-agent: git history shows which agent/task produced which code
 *
 * LOCKED DECISIONS (epic #349):
 *   - Task branch naming: task/{taskId} (lowercase, sanitized)
 *   - Commits include task metadata in the message for traceability
 *   - PRs are OPTIONAL — only created when committee gating is enabled (#353)
 *
 * This module orchestrates gitea-client + company-repo + task-store. The PURE
 * helpers (branch naming, commit message formatting) are unit-tested; the network
 * calls are thin + time-boxed.
 */

import {
  configured,
  taskBranchName,
  createTaskBranch,
  getBranch,
  createTaskPR,
  type GiteaBranch,
  type GiteaPullRequest,
} from './gitea-client'
import {
  buildCommitPlan,
  validateFileMap,
  type FileMap,
} from './company-repo'
import { resolveApp } from '@/lib/build/app-registry'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskGitResult {
  ok: boolean
  branchName?: string
  branchSha?: string
  prNumber?: number
  prUrl?: string
  reason?: string
}

export interface TaskCommitOpts {
  taskId: string
  slug: string
  files: FileMap
  title?: string
  createPR?: boolean
  /**
   * The real Gitea issue number opened for this task before implementation
   * (#905 → #907). When present, the branch name, commit message, and PR body
   * all reference it per docs/audits/AINATIVE_PROCESS_PARITY_GAP_2026-10-04.md
   * §1's convention. Falls back to today's behavior (no issue reference) when
   * absent — a pre-#905 task row, or one whose issue-open attempt failed.
   */
  giteaIssueNumber?: number | null
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable, no I/O)
// ---------------------------------------------------------------------------

/**
 * Format a commit message for a task. PURE. Includes the task ID for traceability
 * in git blame. Format: "Task {taskId}: {title}" or "Task {taskId}" if no title.
 *
 * When `issueNumber` is given (#907), appends a trailing `Refs #N` line per
 * docs/audits/AINATIVE_PROCESS_PARITY_GAP_2026-10-04.md §1's "every commit
 * references it (`Refs #N`)" convention — a soft reference (not auto-closing;
 * `Closes #N` on the PR body handles that), so every intermediate commit on
 * the task branch stays linked to its issue in git history/blame even before
 * the PR merges. Falls back to today's message with no Refs line when
 * `issueNumber` is absent, null, or not a positive finite integer — never
 * emits a malformed reference like `Refs #NaN`.
 */
export function formatTaskCommitMessage(taskId: string, title?: string, issueNumber?: number | null): string {
  const sanitizedId = String(taskId || '').trim().slice(0, 50)
  const sanitizedTitle = String(title || '').trim().slice(0, 200)
  const base = !sanitizedId
    ? sanitizedTitle || 'Task commit'
    : !sanitizedTitle
      ? `Task ${sanitizedId}`
      : `Task ${sanitizedId}: ${sanitizedTitle}`
  const validIssue = Number.isFinite(issueNumber) && (issueNumber as number) > 0
  return validIssue ? `${base}\n\nRefs #${issueNumber}` : base
}

/**
 * Format a PR title for a task. PURE. Format: "[Task] {title}" or "[Task {taskId}]".
 */
export function formatTaskPRTitle(taskId: string, title?: string): string {
  const sanitizedId = String(taskId || '').trim().slice(0, 50)
  const sanitizedTitle = String(title || '').trim().slice(0, 200)
  if (!sanitizedTitle) return `[Task ${sanitizedId || 'unknown'}]`
  return `[Task] ${sanitizedTitle}`
}

/**
 * Format a PR body for a task. PURE. Includes metadata for traceability.
 *
 * When `giteaIssueNumber` is given (#907), opens with a `Closes #N` line so
 * the PR auto-closes its linked Gitea issue on merge — Gitea recognizes the
 * same close-keyword + #N convention GitHub does (confirmed against Gitea's
 * own "Automatically Closing Issues" docs), scoped to the issue and PR being
 * in the SAME repo, which is always true here (both opened against the same
 * company repo in task-resolver.ts / task-git-sync.ts). Falls back to no
 * Closes line when absent, null, or not a positive finite integer — never
 * emits a malformed reference like `Closes #undefined`.
 */
export function formatTaskPRBody(opts: {
  taskId: string
  title?: string
  fileCount: number
  slug: string
  giteaIssueNumber?: number | null
}): string {
  const validIssue = Number.isFinite(opts.giteaIssueNumber) && (opts.giteaIssueNumber as number) > 0
  const lines = [
    opts.title ? `**Title:** ${opts.title}` : '',
    `**Task ID:** ${opts.taskId}`,
    `**Company:** ${opts.slug}`,
    `**Files changed:** ${opts.fileCount}`,
    '',
    '---',
    '*Generated by Cody • [AINative Builder](https://ainative.studio)*',
  ]
  const summary = ['## Task Summary', '', ...lines.filter(Boolean)].join('\n')
  return validIssue ? `Closes #${opts.giteaIssueNumber}\n\n${summary}` : summary
}

/**
 * Validate that a task can be synced to git. PURE. Returns { valid, reason }.
 */
export function validateTaskSync(opts: {
  taskId?: string
  slug?: string
  files?: FileMap
}): { valid: boolean; reason?: string } {
  if (!opts.taskId?.trim()) {
    return { valid: false, reason: 'taskId is required' }
  }
  if (!opts.slug?.trim()) {
    return { valid: false, reason: 'slug is required' }
  }
  if (!opts.files) {
    return { valid: false, reason: 'files are required' }
  }
  const fileValidation = validateFileMap(opts.files)
  if (!fileValidation.valid) {
    return { valid: false, reason: fileValidation.reason }
  }
  return { valid: true }
}

// ---------------------------------------------------------------------------
// Gitea contents API — push files to a branch
// ---------------------------------------------------------------------------

const GITEA_BASE_URL = (process.env.GITEA_BASE_URL || '').replace(/\/+$/, '')
const GITEA_ADMIN_TOKEN = process.env.GITEA_ADMIN_TOKEN || ''
const TIMEOUT_MS = 30000

/**
 * Push files to a specific branch in a Gitea repo. Creates/updates each file
 * with the given commit message. Returns true on success.
 */
async function pushFilesToBranch(
  org: string,
  repo: string,
  branch: string,
  files: Array<{ path: string; content: string }>,
  message: string,
): Promise<boolean> {
  if (!configured() || !org || !repo || !branch || !files.length) return false

  for (const file of files) {
    try {
      const url = `${GITEA_BASE_URL}/api/v1/repos/${org}/${repo}/contents/${file.path}`
      const body: Record<string, unknown> = {
        message,
        content: Buffer.from(file.content, 'utf-8').toString('base64'),
        branch,
      }

      // Check if file exists to get SHA for update
      try {
        const getRes = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, {
          headers: { Authorization: `token ${GITEA_ADMIN_TOKEN}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (getRes.ok) {
          const existing = await getRes.json()
          if (existing.sha) {
            body.sha = existing.sha
          }
        }
      } catch {
        // File doesn't exist — that's fine, create it
      }

      const res = await fetch(url, {
        method: body.sha ? 'PUT' : 'POST',
        headers: {
          Authorization: `token ${GITEA_ADMIN_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (!res.ok && res.status !== 201) {
        console.error(`[task-git-sync] Failed to push ${file.path}: ${res.status}`)
        return false
      }
    } catch (err) {
      console.error(`[task-git-sync] Error pushing ${file.path}:`, err)
      return false
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Main sync functions
// ---------------------------------------------------------------------------

/**
 * Create a branch for a task. Called when a task starts (in_progress).
 * IDEMPOTENT — returns existing branch if present.
 *
 * Flow:
 *   1. Look up the company's git org from app-registry
 *   2. Create the task branch from main (or return existing)
 *
 * `issueNumber` (#907), when given, names the branch
 * task/{issueNumber}-{taskId} instead of today's task/{taskId} — see
 * taskBranchName in gitea-client.ts. Omit (or pass null) to fall back to
 * today's behavior, e.g. for a task whose #905 issue-open attempt failed.
 *
 * Returns { ok, branchName, branchSha, reason } for honest feedback.
 * Never throws — git sync must never break the main task flow.
 */
export async function createBranchForTask(
  slug: string,
  taskId: string,
  issueNumber?: number | null,
): Promise<TaskGitResult> {
  if (!configured()) {
    return { ok: false, reason: 'gitea_not_configured' }
  }
  if (!taskId?.trim()) {
    return { ok: false, reason: 'taskId is required' }
  }
  if (!slug?.trim()) {
    return { ok: false, reason: 'slug is required' }
  }

  // Look up company's git repo
  const app = await resolveApp(slug)
  if (!app?.gitOrg) {
    return { ok: false, reason: 'company_not_git_provisioned' }
  }

  try {
    const branch = await createTaskBranch(app.gitOrg, slug, taskId, undefined, issueNumber)
    if (!branch) {
      return { ok: false, reason: 'branch_creation_failed' }
    }
    return {
      ok: true,
      branchName: branch.name,
      branchSha: branch.commit?.id || branch.commit?.sha,
    }
  } catch (err) {
    console.error(`[task-git-sync] createBranchForTask failed:`, err)
    return { ok: false, reason: 'branch_creation_error' }
  }
}

/**
 * Commit task changes to its branch. Called when a task produces output.
 *
 * Flow:
 *   1. Validate the task and files
 *   2. Look up the company's git org from app-registry
 *   3. Ensure the task branch exists (create if not)
 *   4. Push files to the branch
 *   5. Optionally create a PR if createPR=true
 *
 * Returns { ok, branchName, prNumber, prUrl, reason } for honest feedback.
 * Never throws — git sync must never break the main task flow.
 */
export async function commitTaskChanges(opts: TaskCommitOpts): Promise<TaskGitResult> {
  if (!configured()) {
    return { ok: false, reason: 'gitea_not_configured' }
  }

  // Validate
  const validation = validateTaskSync(opts)
  if (!validation.valid) {
    return { ok: false, reason: validation.reason }
  }

  // Look up company's git repo
  const app = await resolveApp(opts.slug)
  if (!app?.gitOrg) {
    return { ok: false, reason: 'company_not_git_provisioned' }
  }

  try {
    // Ensure branch exists — issue number (if any) must match the one used
    // below for taskBranchName/createTaskPR, or branch creation and lookup
    // would silently diverge onto two different branches.
    const branchResult = await createBranchForTask(opts.slug, opts.taskId, opts.giteaIssueNumber)
    if (!branchResult.ok) {
      return branchResult
    }

    const branchName = taskBranchName(opts.taskId, opts.giteaIssueNumber)
    const fileList = Object.entries(opts.files).map(([path, content]) => ({
      path,
      content,
    }))
    const commitMsg = formatTaskCommitMessage(opts.taskId, opts.title, opts.giteaIssueNumber)

    // Push files
    const pushed = await pushFilesToBranch(
      app.gitOrg,
      opts.slug,
      branchName,
      fileList,
      commitMsg,
    )
    if (!pushed) {
      return { ok: false, branchName, reason: 'commit_push_failed' }
    }

    // Get updated branch SHA
    const updatedBranch = await getBranch(app.gitOrg, opts.slug, branchName)
    const result: TaskGitResult = {
      ok: true,
      branchName,
      branchSha: updatedBranch?.commit?.id || updatedBranch?.commit?.sha,
    }

    // Optionally create PR
    if (opts.createPR) {
      const pr = await createTaskPR(app.gitOrg, opts.slug, {
        taskId: opts.taskId,
        title: formatTaskPRTitle(opts.taskId, opts.title),
        body: formatTaskPRBody({
          taskId: opts.taskId,
          title: opts.title,
          fileCount: fileList.length,
          slug: opts.slug,
          giteaIssueNumber: opts.giteaIssueNumber,
        }),
        issueNumber: opts.giteaIssueNumber,
      })
      if (pr) {
        result.prNumber = pr.number
        result.prUrl = pr.html_url
      }
    }

    return result
  } catch (err) {
    console.error(`[task-git-sync] commitTaskChanges failed:`, err)
    // Real gap found live (#698 follow-up): this generic 'commit_error' masked
    // the actual thrown reason (e.g. createTaskPR's real
    // "gitea createTaskPR ... failed: 4xx/5xx" message) behind a useless
    // constant string, making live failures like this one unnecessarily hard
    // to diagnose. Include the real message when there is one.
    const detail = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: detail ? `commit_error: ${detail}` : 'commit_error' }
  }
}

/**
 * One-shot: commit task and open a PR. Convenience wrapper for committee-gated
 * workflows where every task goes through review.
 */
export async function commitTaskWithPR(opts: Omit<TaskCommitOpts, 'createPR'>): Promise<TaskGitResult> {
  return commitTaskChanges({ ...opts, createPR: true })
}
