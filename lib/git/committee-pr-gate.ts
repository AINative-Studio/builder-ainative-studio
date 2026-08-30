/**
 * Committee PR Gate (#349 scope 4) — wires the multi-model committee review
 * as an approval gate on Gitea PRs before merge.
 *
 * Flow:
 *   1. PR created (task-git-sync.ts → createTaskPR)
 *   2. Gitea webhook triggers this gate
 *   3. Fetch PR diff
 *   4. Run committee review on the diff
 *   5. Post committee verdict as PR review
 *   6. Block merge if verdict != approve
 *
 * This module provides the webhook handler and the PR review poster.
 * The committee review logic is in lib/agent/committee-review.ts.
 */

import {
  configured,
  findPRByHead,
  taskBranchName,
  fetchRepoFiles,
  type GiteaPullRequest,
} from './gitea-client'
import { checkAllStandards, formatForCommittee } from '@/lib/build/coding-standards'
import { runCoverage } from '@/lib/build/coverage-runner'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PRReviewRequest {
  org: string
  repo: string
  prNumber: number
  diff?: string
  /** The PR's head branch (#375) — needed to measure REAL coverage against
   *  the PR's actual resulting file state, not just the base branch. Optional
   *  for backward compatibility with existing callers; when absent, the
   *  standards gate falls back to the file-existence-only check (unchanged
   *  behavior) rather than failing the whole gate. */
  headRef?: string
}

export interface PRReviewResult {
  ok: boolean
  verdict: 'approve' | 'request-changes' | 'pending'
  summary: string
  details?: string
  reviewId?: number
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GITEA_BASE_URL = (process.env.GITEA_BASE_URL || '').replace(/\/+$/, '')
const GITEA_ADMIN_TOKEN = process.env.GITEA_ADMIN_TOKEN || ''
const TIMEOUT_MS = 30000

// ---------------------------------------------------------------------------
// Gitea PR API helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the diff for a PR. Returns the raw diff text.
 */
export async function fetchPRDiff(
  org: string,
  repo: string,
  prNumber: number
): Promise<string | null> {
  if (!configured()) return null
  try {
    const res = await fetch(
      `${GITEA_BASE_URL}/api/v1/repos/${org}/${repo}/pulls/${prNumber}.diff`,
      {
        headers: { Authorization: `token ${GITEA_ADMIN_TOKEN}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    )
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/**
 * Post a review on a PR. Returns the review ID on success.
 */
export async function postPRReview(
  org: string,
  repo: string,
  prNumber: number,
  opts: {
    body: string
    event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  }
): Promise<number | null> {
  if (!configured()) return null
  try {
    const res = await fetch(
      `${GITEA_BASE_URL}/api/v1/repos/${org}/${repo}/pulls/${prNumber}/reviews`,
      {
        method: 'POST',
        headers: {
          Authorization: `token ${GITEA_ADMIN_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          body: opts.body,
          event: opts.event,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.id || null
  } catch {
    return null
  }
}

/**
 * Get the list of changed files in a PR.
 */
export async function getPRChangedFiles(
  org: string,
  repo: string,
  prNumber: number
): Promise<string[]> {
  if (!configured()) return []
  try {
    const res = await fetch(
      `${GITEA_BASE_URL}/api/v1/repos/${org}/${repo}/pulls/${prNumber}/files`,
      {
        headers: { Authorization: `token ${GITEA_ADMIN_TOKEN}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    )
    if (!res.ok) return []
    const files = await res.json()
    return files.map((f: { filename: string }) => f.filename)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Committee gate logic
// ---------------------------------------------------------------------------

/**
 * Measure REAL coverage for a PR's head branch (#375, closes #369). Returns
 * undefined (not 0) when it genuinely can't be measured — an app with no
 * test suite, an unreadable repo state, or a coverage run that fails to
 * produce a number — so checkAllStandards skips the coverage check entirely
 * rather than gating on a fabricated number. Never throws.
 */
async function measurePRCoverage(org: string, repo: string, headRef: string): Promise<number | undefined> {
  try {
    const files = await fetchRepoFiles(org, repo, headRef)
    if (!files) return undefined
    const coverage = await runCoverage(files)
    if (!coverage.testable || coverage.coveragePercent === null) return undefined
    return coverage.coveragePercent
  } catch {
    return undefined
  }
}

/**
 * Run the coding standards check on a PR. This is the first gate before
 * the committee review — ensures basic hygiene (no AI attribution, etc).
 */
export async function runStandardsGate(req: PRReviewRequest): Promise<PRReviewResult> {
  if (!configured()) {
    return { ok: false, verdict: 'pending', summary: 'Gitea not configured' }
  }

  // Get changed files
  const changedFiles = await getPRChangedFiles(req.org, req.repo, req.prNumber)

  // Get test files (approximate: look for .test. files in the diff)
  const testFiles = changedFiles.filter((f) => /\.(test|spec)\.(ts|tsx)$/.test(f))

  // Real coverage (#375): only attempted when the caller supplied the PR's
  // head branch. Absent that, `coverage` stays undefined and
  // checkAllStandards simply skips the coverage check — unchanged behavior
  // for any existing caller that predates this wiring.
  const coverage = req.headRef ? await measurePRCoverage(req.org, req.repo, req.headRef) : undefined

  // Run standards check
  const result = checkAllStandards({
    changedFiles,
    testFiles,
    coverage,
  })

  const committee = formatForCommittee(result)

  // Post review
  const event = committee.verdict === 'approve' ? 'APPROVE' : 'REQUEST_CHANGES'
  const reviewId = await postPRReview(req.org, req.repo, req.prNumber, {
    body: `## Coding Standards Gate\n\n${committee.details}`,
    event,
  })

  return {
    ok: result.passed,
    verdict: committee.verdict,
    summary: committee.summary,
    details: committee.details,
    reviewId: reviewId || undefined,
  }
}

/**
 * Run the full committee review on a PR. This invokes the multi-model
 * committee (claude/qwen/gemini) to review the diff.
 *
 * NOTE: The actual committee review logic is in lib/agent/committee-review.ts.
 * This function wires it to the PR gate flow.
 */
export async function runCommitteeGate(req: PRReviewRequest): Promise<PRReviewResult> {
  if (!configured()) {
    return { ok: false, verdict: 'pending', summary: 'Gitea not configured' }
  }

  // First run standards gate
  const standardsResult = await runStandardsGate(req)
  if (!standardsResult.ok) {
    return standardsResult
  }

  // Fetch diff for committee review
  const diff = req.diff || (await fetchPRDiff(req.org, req.repo, req.prNumber))
  if (!diff) {
    return { ok: false, verdict: 'pending', summary: 'Could not fetch PR diff' }
  }

  // TODO: Wire to lib/agent/committee-review.ts when committee is enabled
  // For now, standards gate is sufficient
  return {
    ok: true,
    verdict: 'approve',
    summary: 'Standards check passed (committee review pending implementation)',
    details: standardsResult.details,
  }
}

// ---------------------------------------------------------------------------
// Webhook handler
// ---------------------------------------------------------------------------

export interface GiteaWebhookPayload {
  action: string
  number: number
  pull_request?: GiteaPullRequest
  repository?: {
    name: string
    owner: { login: string }
  }
}

/**
 * Handle a Gitea PR webhook. Called when a PR is opened or synchronized.
 * Runs the committee gate and posts the review.
 */
export async function handlePRWebhook(
  payload: GiteaWebhookPayload
): Promise<PRReviewResult> {
  const { action, number, pull_request, repository } = payload

  if (!['opened', 'synchronize', 'reopened'].includes(action)) {
    return { ok: true, verdict: 'pending', summary: `Ignored action: ${action}` }
  }

  if (!repository || !pull_request) {
    return { ok: false, verdict: 'pending', summary: 'Invalid webhook payload' }
  }

  const org = repository.owner.login
  const repo = repository.name

  return runCommitteeGate({ org, repo, prNumber: number, headRef: pull_request.head?.ref })
}
