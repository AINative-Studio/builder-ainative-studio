/**
 * Per-company Gitea repository provisioning (#355 · GIT-2). When a company is
 * provisioned, create its private Gitea repo and push the generated app as the
 * INITIAL commit. Every regeneration = a NEW commit → real version history,
 * not a blob overwrite.
 *
 * LOCKED DECISIONS (epic #349):
 *   - org-per-workspace (one Gitea org per AINative workspace)
 *   - founder access = read-only mirror + edits-via-Cody, with optional human
 *     collaborator write grant
 *   - LFS / assets reuse the existing ZeroDB/MinIO files bucket (no new bucket)
 *
 * This module orchestrates the gitea-client + app-registry calls. The PURE
 * helpers (commit message formatting, file-tree → Gitea contents payload) are
 * unit-tested; the network calls are thin + time-boxed.
 */

import {
  configured,
  provisionCompanyRepo as giteaProvisionRepo,
  addCollaborator,
  type GiteaPermission,
} from './gitea-client'
import { resolveApp, setAppGitRepo } from '@/lib/build/app-registry'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileMap {
  [path: string]: string
}

export interface CommitPlan {
  message: string
  files: Array<{ path: string; content: string }>
  isInitial: boolean
}

export interface ProvisionResult {
  ok: boolean
  gitRepoUrl?: string
  gitRepoId?: string
  gitOrg?: string
  reason?: string
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable, no I/O)
// ---------------------------------------------------------------------------

/**
 * Format the commit message for an initial or regeneration commit. PURE.
 * Initial commits get a clean "Initial commit" message; regenerations include
 * the task label if provided for blame-per-task traceability.
 */
export function formatCommitMessage(opts: {
  isInitial: boolean
  taskLabel?: string
  slug: string
}): string {
  if (opts.isInitial) {
    return `Initial commit: ${opts.slug}`
  }
  const task = opts.taskLabel ? ` (${opts.taskLabel})` : ''
  return `Regeneration${task}: ${opts.slug}`
}

/**
 * Build the commit plan from a file map. PURE. The plan includes the formatted
 * message and the file list in Gitea contents API format.
 */
export function buildCommitPlan(opts: {
  files: FileMap
  isInitial: boolean
  taskLabel?: string
  slug: string
}): CommitPlan {
  const message = formatCommitMessage({
    isInitial: opts.isInitial,
    taskLabel: opts.taskLabel,
    slug: opts.slug,
  })
  const fileList = Object.entries(opts.files).map(([path, content]) => ({
    path,
    content,
  }))
  return { message, files: fileList, isInitial: opts.isInitial }
}

/**
 * Validate that a file map has the minimum required content. PURE.
 * At minimum, a generated app must have an App.tsx (or similar entry).
 */
export function validateFileMap(files: FileMap): { valid: boolean; reason?: string } {
  if (!files || typeof files !== 'object') {
    return { valid: false, reason: 'files must be an object' }
  }
  const paths = Object.keys(files)
  if (paths.length === 0) {
    return { valid: false, reason: 'files map is empty' }
  }
  const hasEntry = paths.some(
    (p) => p.endsWith('App.tsx') || p.endsWith('App.jsx') || p.endsWith('index.tsx')
  )
  if (!hasEntry) {
    return { valid: false, reason: 'missing entry file (App.tsx/App.jsx/index.tsx)' }
  }
  return { valid: true }
}

// ---------------------------------------------------------------------------
// Gitea contents API — push files to a repo
// ---------------------------------------------------------------------------

const GITEA_BASE_URL = (process.env.GITEA_BASE_URL || '').replace(/\/+$/, '')
const GITEA_ADMIN_TOKEN = process.env.GITEA_ADMIN_TOKEN || ''
const TIMEOUT_MS = 30000

/**
 * Push files to a Gitea repo via the contents API. Creates/updates each file
 * with the given commit message. For initial commits to an empty repo, this
 * creates the files; for regenerations, it updates them (Gitea auto-detects).
 *
 * Returns true on success, false on failure. Logs errors but doesn't throw —
 * repo operations must never break the main generation path.
 */
async function pushFilesToRepo(
  org: string,
  repo: string,
  plan: CommitPlan,
): Promise<boolean> {
  if (!configured()) return false
  const branch = 'main'

  for (const file of plan.files) {
    try {
      const url = `${GITEA_BASE_URL}/api/v1/repos/${org}/${repo}/contents/${file.path}`
      const body: Record<string, unknown> = {
        message: plan.message,
        content: Buffer.from(file.content, 'utf-8').toString('base64'),
        branch,
      }

      // For updates, we need the file's SHA. Try to get it first.
      if (!plan.isInitial) {
        try {
          const getRes = await fetch(url, {
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
          // File doesn't exist yet — that's fine, create it
        }
      }

      const res = await fetch(url, {
        method: plan.isInitial && !body.sha ? 'POST' : 'PUT',
        headers: {
          Authorization: `token ${GITEA_ADMIN_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (!res.ok && res.status !== 201) {
        console.error(`[company-repo] Failed to push ${file.path}: ${res.status}`)
        return false
      }
    } catch (err) {
      console.error(`[company-repo] Error pushing ${file.path}:`, err)
      return false
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Main provisioning + commit functions
// ---------------------------------------------------------------------------

/**
 * Provision a per-company Gitea repo and push the initial commit. Called when
 * a new company is registered (instant-db provision / register-app flow).
 *
 * Flow:
 *   1. Check if already provisioned (idempotent — skip if gitRepoId exists)
 *   2. Create org + repo via gitea-client (idempotent)
 *   3. Push the generated files as the initial commit
 *   4. Record the repo handle in app-registry via setAppGitRepo
 *
 * Returns { ok, gitRepoUrl, gitRepoId, gitOrg, reason } for honest feedback.
 * Never throws — repo provisioning must never break the main build path.
 */
export async function provisionCompanyRepo(opts: {
  workspaceId: string
  slug: string
  files: FileMap
}): Promise<ProvisionResult> {
  if (!configured()) {
    return { ok: false, reason: 'gitea_not_configured' }
  }

  // Validate files
  const validation = validateFileMap(opts.files)
  if (!validation.valid) {
    return { ok: false, reason: validation.reason }
  }

  // Check if already provisioned (idempotent)
  const existing = await resolveApp(opts.slug)
  if (existing?.gitRepoId) {
    return {
      ok: true,
      gitRepoUrl: existing.gitRepoUrl,
      gitRepoId: existing.gitRepoId,
      gitOrg: existing.gitOrg,
      reason: 'already_provisioned',
    }
  }

  // Create org + repo
  const result = await giteaProvisionRepo(opts.workspaceId, opts.slug)
  if (!result) {
    return { ok: false, reason: 'gitea_provision_failed' }
  }

  const { org, repo } = result
  const gitRepoUrl = `${GITEA_BASE_URL}/${org.username}/${repo.name}.git`
  const gitRepoId = String(repo.id)
  const gitOrg = org.username

  // Push initial commit
  const plan = buildCommitPlan({
    files: opts.files,
    isInitial: true,
    slug: opts.slug,
  })
  const pushed = await pushFilesToRepo(org.username, repo.name, plan)
  if (!pushed) {
    return { ok: false, reason: 'initial_commit_failed', gitRepoUrl, gitRepoId, gitOrg }
  }

  // Record in app-registry
  const recorded = await setAppGitRepo(opts.slug, { gitRepoUrl, gitRepoId, gitOrg })
  if (!recorded) {
    console.warn(`[company-repo] Repo created but registry update failed for ${opts.slug}`)
  }

  return { ok: true, gitRepoUrl, gitRepoId, gitOrg }
}

/**
 * Commit a regeneration to an existing company repo. Called when a company's
 * app is regenerated (new build on an existing company).
 *
 * Flow:
 *   1. Look up the existing repo handle from app-registry
 *   2. Push the new files as a regeneration commit (real history, not overwrite)
 *
 * Returns true on success. Never throws. If the company has no repo yet,
 * returns false (the caller should provision first).
 */
export async function commitRegeneration(opts: {
  slug: string
  files: FileMap
  taskLabel?: string
}): Promise<boolean> {
  if (!configured()) return false

  const validation = validateFileMap(opts.files)
  if (!validation.valid) return false

  const existing = await resolveApp(opts.slug)
  if (!existing?.gitRepoId || !existing.gitOrg) {
    return false // No repo yet — caller should provision first
  }

  const plan = buildCommitPlan({
    files: opts.files,
    isInitial: false,
    taskLabel: opts.taskLabel,
    slug: opts.slug,
  })

  // Extract repo name from the gitRepoUrl or use slug
  const repoName = opts.slug
  return pushFilesToRepo(existing.gitOrg, repoName, plan)
}

/**
 * Grant a human user write access to a company's repo. The default is read-only
 * mirror + edits-via-Cody; this explicitly grants write permission to a specific
 * user (per locked decision #3: optional human collaborator).
 */
export async function grantHumanWrite(
  slug: string,
  username: string,
  permission: GiteaPermission = 'write',
): Promise<boolean> {
  if (!configured()) return false

  const existing = await resolveApp(slug)
  if (!existing?.gitOrg) return false

  return addCollaborator(existing.gitOrg, slug, username, permission)
}
