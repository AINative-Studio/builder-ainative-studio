/**
 * Gitea provisioning client (#354 · GIT-1) — a typed, thin client over the Gitea
 * REST API that gives every AINative company its own private git repository, so
 * Cody's edits and the generated app's source are version-controlled and a founder
 * can be granted a read-only mirror (with an optional human-write collaborator).
 *
 * LOCKED DECISIONS (epic #349):
 *   1. org-per-workspace — ONE Gitea org per AINative workspace, ONE private repo
 *      per company slug (ensureOrg(workspaceId) → createRepo(org, slug)).
 *   2. LFS / large assets REUSE the existing ZeroDB files bucket (MinIO), the same
 *      primitive lib/build/media-upload.ts + media-schedule.ts already use — this
 *      client does NOT provision any bucket.
 *   3. founder access = read-only mirror + edits-via-Cody, with an OPTIONAL human
 *      collaborator write grant (addCollaborator).
 *
 * DESIGN — mirrors lib/build/app-registry.ts exactly:
 *   - config captured at module load from env (GITEA_BASE_URL, GITEA_ADMIN_TOKEN)
 *   - configured() guard: every call degrades gracefully (returns null) when unset,
 *     so a deploy without Gitea configured never throws.
 *   - every network call is time-boxed with AbortSignal.timeout.
 *   - idempotent creates: ensureOrg / createRepo return the existing entity on 409
 *     (or when a pre-flight GET finds it), so a re-run never errors or duplicates.
 *   - THROWS on genuine failure (non-idempotent non-ok), so callers can surface an
 *     honest error — distinct from the null "not configured" degradation.
 *
 * Ops note: LIVE provisioning of the Gitea host itself (a Railway service) is a
 * STAGED FOUNDER/OPS step — see docs/GITEA_PROVISIONING.md. This client is the code
 * that WILL provision company repos once GITEA_* point at that live host; it is not
 * run here and does NOT execute `railway up`.
 */

// ---------------------------------------------------------------------------
// Config (captured at module load, mirroring app-registry.ts)
// ---------------------------------------------------------------------------

const GITEA_BASE_URL = (process.env.GITEA_BASE_URL || '').replace(/\/+$/, '')
const GITEA_ADMIN_TOKEN = process.env.GITEA_ADMIN_TOKEN || ''

/** Default per-call timeout (ms). Gitea create ops are fast; keep them time-boxed. */
const TIMEOUT_MS = 15000

/** True only when both the Gitea host and an admin token are configured. */
export function configured(): boolean {
  return Boolean(GITEA_BASE_URL && GITEA_ADMIN_TOKEN)
}

function apiUrl(path: string): string {
  // Gitea REST API v1 lives under /api/v1. `path` is expected to start with '/'.
  return `${GITEA_BASE_URL}/api/v1${path}`
}

function headers(): Record<string, string> {
  return {
    Authorization: `token ${GITEA_ADMIN_TOKEN}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

// ---------------------------------------------------------------------------
// Types (a minimal shape of the Gitea REST responses we consume)
// ---------------------------------------------------------------------------

/** Collaborator permission levels Gitea accepts on a repo. */
export type GiteaPermission = 'read' | 'write' | 'admin'

/** The subset of a Gitea org we surface. */
export interface GiteaOrg {
  id: number
  username: string // the org name (Gitea models orgs as users)
}

/** The subset of a Gitea repository we surface. */
export interface GiteaRepo {
  id: number
  name: string
  full_name: string // "{org}/{slug}"
  private: boolean
  clone_url: string // https clone URL — persisted as gitRepoUrl on the AppEntry
  html_url: string
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/**
 * Derive the Gitea org name for an AINative workspace (org-per-workspace, #349).
 * PURE — no I/O. Gitea org names must be lowercase alphanumeric with single
 * dashes; we prefix `ws-` so the org is recognizable and never collides with a
 * bare slug. Returns '' for an empty/invalid workspaceId so callers can guard.
 */
export function orgNameForWorkspace(workspaceId: string): string {
  const clean = String(workspaceId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return clean ? `ws-${clean}` : ''
}

/**
 * Sanitize a company slug into a valid Gitea repo name. PURE — no I/O. Gitea repo
 * names allow alphanumerics, dash, underscore and dot; we normalize to the same
 * lowercase-dash form the rest of the builder uses for slugs.
 */
export function repoNameForSlug(slug: string): string {
  return String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
}

// ---------------------------------------------------------------------------
// Fetch wrapper
// ---------------------------------------------------------------------------

/**
 * Thin time-boxed fetch over the Gitea API. Returns the raw Response so callers
 * can branch on status (e.g. treat 409 as idempotent-exists). Never swallows the
 * error itself — the caller decides degradation vs throw.
 */
async function giteaFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get an org by name, or null if it does not exist (404) / Gitea is unconfigured.
 * THROWS on any other non-ok status (auth / server error).
 */
export async function getOrg(org: string): Promise<GiteaOrg | null> {
  if (!configured() || !org) return null
  const res = await giteaFetch(`/orgs/${encodeURIComponent(org)}`, { method: 'GET' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`gitea getOrg ${org} failed: ${res.status}`)
  return (await res.json()) as GiteaOrg
}

/**
 * Ensure a Gitea org exists for an AINative workspace (org-per-workspace, #349).
 * IDEMPOTENT: returns the existing org if present, otherwise creates it. Returns
 * null when Gitea is unconfigured (graceful degradation) or the workspaceId is
 * invalid. THROWS on a genuine create failure.
 */
export async function ensureOrg(workspaceId: string): Promise<GiteaOrg | null> {
  if (!configured()) return null
  const org = orgNameForWorkspace(workspaceId)
  if (!org) return null

  // Pre-flight: already there → return it (idempotent, no create).
  const existing = await getOrg(org)
  if (existing) return existing

  const res = await giteaFetch('/orgs', {
    method: 'POST',
    body: JSON.stringify({ username: org, visibility: 'private' }),
  })
  // 409 = created concurrently between our GET and POST → re-fetch and return.
  if (res.status === 409) {
    const raced = await getOrg(org)
    if (raced) return raced
  }
  if (!res.ok) throw new Error(`gitea ensureOrg ${org} failed: ${res.status}`)
  return (await res.json()) as GiteaOrg
}

/**
 * Get a repo, or null if it does not exist (404) / Gitea is unconfigured.
 * THROWS on any other non-ok status.
 */
export async function getRepo(org: string, slug: string): Promise<GiteaRepo | null> {
  if (!configured() || !org) return null
  const repo = repoNameForSlug(slug)
  if (!repo) return null
  const res = await giteaFetch(
    `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`,
    { method: 'GET' },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`gitea getRepo ${org}/${repo} failed: ${res.status}`)
  return (await res.json()) as GiteaRepo
}

/**
 * Create a PRIVATE repo under an org for a company slug (one repo per company, #349).
 * IDEMPOTENT: returns the existing repo if present (pre-flight GET or 409 on create),
 * otherwise creates it via the org-repos endpoint. Returns null when unconfigured or
 * the org/slug is invalid. THROWS on a genuine create failure.
 *
 * `opts.private` defaults to true — company repos are always private.
 */
export async function createRepo(
  org: string,
  slug: string,
  opts: { private?: boolean; description?: string; autoInit?: boolean } = {},
): Promise<GiteaRepo | null> {
  if (!configured() || !org) return null
  const repo = repoNameForSlug(slug)
  if (!repo) return null

  // Pre-flight: already there → return it (idempotent, no create).
  const existing = await getRepo(org, repo)
  if (existing) return existing

  const res = await giteaFetch(`/orgs/${encodeURIComponent(org)}/repos`, {
    method: 'POST',
    body: JSON.stringify({
      name: repo,
      private: opts.private !== false, // default true
      description: opts.description || `AINative company: ${slug}`,
      auto_init: opts.autoInit ?? true,
    }),
  })
  // 409 = raced create → re-fetch and return the existing repo.
  if (res.status === 409) {
    const raced = await getRepo(org, repo)
    if (raced) return raced
  }
  if (!res.ok) throw new Error(`gitea createRepo ${org}/${repo} failed: ${res.status}`)
  return (await res.json()) as GiteaRepo
}

/**
 * Grant a human collaborator access to a company repo (#349, decision 3) — the
 * OPTIONAL human-write grant on top of the founder's read-only mirror. Gitea's
 * add-collaborator endpoint is a PUT and is idempotent by nature (re-granting the
 * same permission is a 204 no-op), so this can be called repeatedly.
 *
 * Returns true on success (204/201/200), false when Gitea is unconfigured or the
 * inputs are invalid. THROWS on a genuine failure (e.g. unknown user, 404/500).
 */
export async function addCollaborator(
  org: string,
  slug: string,
  user: string,
  permission: GiteaPermission = 'read',
): Promise<boolean> {
  if (!configured() || !org || !user) return false
  const repo = repoNameForSlug(slug)
  if (!repo) return false
  const res = await giteaFetch(
    `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/collaborators/${encodeURIComponent(user)}`,
    { method: 'PUT', body: JSON.stringify({ permission }) },
  )
  if (!res.ok) {
    throw new Error(`gitea addCollaborator ${org}/${repo}#${user} failed: ${res.status}`)
  }
  return true
}

/**
 * One-shot provision helper: ensure the workspace org, then the company's private
 * repo. Returns { org, repo } or null when unconfigured / inputs invalid. This is
 * the seam the build/deploy pipeline calls; persistence of the resulting repo URL/id
 * onto the AppEntry is done by the caller via setAppGitRepo (lib/build/app-registry).
 */
export async function provisionCompanyRepo(
  workspaceId: string,
  slug: string,
): Promise<{ org: GiteaOrg; repo: GiteaRepo } | null> {
  if (!configured()) return null
  const org = await ensureOrg(workspaceId)
  if (!org) return null
  const repo = await createRepo(org.username, slug, { private: true })
  if (!repo) return null
  return { org, repo }
}

// ---------------------------------------------------------------------------
// Branch operations (#356 GIT-3 — task→branch mapping)
// ---------------------------------------------------------------------------

/** A minimal branch reference returned by Gitea. */
export interface GiteaBranch {
  name: string
  commit: { sha: string; url?: string }
}

/**
 * Get the default branch's HEAD SHA. Returns null if not found or unconfigured.
 * THROWS on non-404 errors.
 */
export async function getDefaultBranchSha(org: string, repo: string): Promise<string | null> {
  if (!configured() || !org || !repo) return null
  const repoName = repoNameForSlug(repo)
  const res = await giteaFetch(
    `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repoName)}/branches/main`,
    { method: 'GET' },
  )
  if (res.status === 404) {
    // Try master if main doesn't exist
    const masterRes = await giteaFetch(
      `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repoName)}/branches/master`,
      { method: 'GET' },
    )
    if (masterRes.status === 404) return null
    if (!masterRes.ok) return null
    const master = (await masterRes.json()) as GiteaBranch
    return master.commit?.sha || null
  }
  if (!res.ok) return null
  const branch = (await res.json()) as GiteaBranch
  return branch.commit?.sha || null
}

/**
 * Create a branch for a task. PURE naming: task/{taskId}. IDEMPOTENT — returns
 * the existing branch if present. Returns null when unconfigured. THROWS on
 * genuine failures.
 */
export async function createTaskBranch(
  org: string,
  repo: string,
  taskId: string,
  baseSha?: string,
): Promise<GiteaBranch | null> {
  if (!configured() || !org || !repo || !taskId) return null
  const repoName = repoNameForSlug(repo)
  const branchName = taskBranchName(taskId)

  // Pre-flight: already exists?
  const existing = await getBranch(org, repoName, branchName)
  if (existing) return existing

  // Get base SHA if not provided
  let sha: string | undefined = baseSha
  if (!sha) {
    const defaultSha = await getDefaultBranchSha(org, repo)
    if (!defaultSha) return null
    sha = defaultSha
  }

  const res = await giteaFetch(
    `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repoName)}/branches`,
    {
      method: 'POST',
      body: JSON.stringify({
        new_branch_name: branchName,
        old_ref_name: sha,
      }),
    },
  )
  if (res.status === 409) {
    // Race condition — branch created concurrently
    return getBranch(org, repoName, branchName)
  }
  if (!res.ok) throw new Error(`gitea createTaskBranch ${branchName} failed: ${res.status}`)
  return (await res.json()) as GiteaBranch
}

/**
 * Get a branch by name. Returns null if not found or unconfigured.
 */
export async function getBranch(
  org: string,
  repo: string,
  branchName: string,
): Promise<GiteaBranch | null> {
  if (!configured() || !org || !repo || !branchName) return null
  const repoName = repoNameForSlug(repo)
  const res = await giteaFetch(
    `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repoName)}/branches/${encodeURIComponent(branchName)}`,
    { method: 'GET' },
  )
  if (res.status === 404) return null
  if (!res.ok) return null
  return (await res.json()) as GiteaBranch
}

/**
 * Derive the branch name for a task. PURE. Format: task/{taskId}
 * Sanitizes the taskId to be a valid git branch name.
 */
export function taskBranchName(taskId: string): string {
  const clean = String(taskId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  return clean ? `task/${clean}` : ''
}

// ---------------------------------------------------------------------------
// Pull Request operations (#356 GIT-3 — task→PR mapping)
// ---------------------------------------------------------------------------

/** A minimal PR reference returned by Gitea. */
export interface GiteaPullRequest {
  id: number
  number: number
  title: string
  body?: string
  state: string
  html_url: string
  head: { ref: string; sha?: string }
  base: { ref: string }
}

/**
 * Create a pull request from a task branch to main. IDEMPOTENT — if a PR already
 * exists for this head→base, returns it. Returns null when unconfigured.
 * THROWS on genuine failures.
 */
export async function createTaskPR(
  org: string,
  repo: string,
  opts: {
    taskId: string
    title: string
    body?: string
    baseBranch?: string
  },
): Promise<GiteaPullRequest | null> {
  if (!configured() || !org || !repo || !opts.taskId) return null
  const repoName = repoNameForSlug(repo)
  const headBranch = taskBranchName(opts.taskId)
  const baseBranch = opts.baseBranch || 'main'

  // Pre-flight: check if PR already exists for this branch
  const existing = await findPRByHead(org, repoName, headBranch)
  if (existing) return existing

  const res = await giteaFetch(
    `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repoName)}/pulls`,
    {
      method: 'POST',
      body: JSON.stringify({
        title: opts.title,
        body: opts.body || '',
        head: headBranch,
        base: baseBranch,
      }),
    },
  )
  if (res.status === 409 || res.status === 422) {
    // PR may already exist — try to find it
    const raced = await findPRByHead(org, repoName, headBranch)
    if (raced) return raced
  }
  if (!res.ok) throw new Error(`gitea createTaskPR ${org}/${repoName}#${opts.taskId} failed: ${res.status}`)
  return (await res.json()) as GiteaPullRequest
}

/**
 * Find an open PR by head branch. Returns null if none found.
 */
export async function findPRByHead(
  org: string,
  repo: string,
  headBranch: string,
): Promise<GiteaPullRequest | null> {
  if (!configured() || !org || !repo || !headBranch) return null
  const repoName = repoNameForSlug(repo)
  const res = await giteaFetch(
    `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repoName)}/pulls?state=open&head=${encodeURIComponent(headBranch)}`,
    { method: 'GET' },
  )
  if (!res.ok) return null
  const prs = (await res.json()) as GiteaPullRequest[]
  return prs.find((pr) => pr.head.ref === headBranch) || null
}

/**
 * Merge a pull request (#468). Squash-merges by default — a task branch is a
 * single logical change, and squashing keeps the company's `main` history
 * readable rather than importing every intermediate implementation commit.
 * Returns true on a successful merge, false on any failure (already merged,
 * conflicts, PR not found, Gitea unconfigured) — never throws, since this is
 * called from an autonomous pipeline that must degrade to "still a PR, just
 * not auto-merged" rather than crash the whole task resolution.
 */
export async function mergeTaskPR(
  org: string,
  repo: string,
  prNumber: number,
): Promise<boolean> {
  if (!configured() || !org || !repo || !prNumber) return false
  const repoName = repoNameForSlug(repo)
  try {
    const res = await giteaFetch(
      `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repoName)}/pulls/${prNumber}/merge`,
      {
        method: 'POST',
        body: JSON.stringify({ Do: 'squash' }),
      },
    )
    // 200 = merged. 405 = not mergeable (conflicts, checks pending, already
    // merged) — a real, expected outcome, not a crash; the PR simply stays
    // open for manual resolution.
    return res.ok
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Repo file fetch (#373/#374 — read a company's CURRENT generated app before
// implementing a backlog task against it, and before coverage-verifying the
// result)
// ---------------------------------------------------------------------------

interface GiteaTreeEntry {
  path: string
  type: 'blob' | 'tree'
  sha: string
  size?: number
}

interface GiteaTreeResponse {
  tree: GiteaTreeEntry[]
  truncated?: boolean
}

/** Files this large are almost certainly binary/generated assets, not source
 *  the implementation step needs to read — skip them rather than pulling
 *  megabytes of base64 into the LLM's context for no benefit. */
export const MAX_FETCHABLE_FILE_BYTES = 200_000

/**
 * Filter a Gitea tree listing down to fetchable text-source blobs — real
 * files (not subtrees) at or under the size ceiling. PURE, unit-testable
 * without a network call.
 */
export function filterFetchableBlobs(tree: GiteaTreeEntry[]): GiteaTreeEntry[] {
  return tree.filter(
    (e) => e.type === 'blob' && (e.size === undefined || e.size <= MAX_FETCHABLE_FILE_BYTES),
  )
}

/**
 * Decode a Gitea contents-API response body into UTF-8 text, or null when the
 * body isn't a valid base64-encoded text payload (binary content, malformed
 * response). PURE.
 */
export function decodeGiteaContent(body: { content?: string; encoding?: string } | null | undefined): string | null {
  if (!body?.content || body.encoding !== 'base64') return null
  try {
    return Buffer.from(body.content, 'base64').toString('utf-8')
  } catch {
    return null
  }
}

/**
 * Fetch every text file's current content from a branch (default: main), as a
 * flat path→content map. Returns null when unconfigured or the repo/branch
 * doesn't exist — never throws for a missing repo (a company that hasn't been
 * git-provisioned yet is a normal state, not an error). THROWS on a genuine
 * API failure (auth/server error) so a real outage is visible, not silently
 * treated as "empty repo."
 *
 * Skips files over MAX_FETCHABLE_FILE_BYTES and anything the base64 decode
 * fails on (binary content) — callers get a best-effort source-file map, not
 * a byte-perfect mirror of the repo.
 */
export async function fetchRepoFiles(
  org: string,
  repo: string,
  branch = 'main',
): Promise<Record<string, string> | null> {
  if (!configured() || !org || !repo) return null
  const repoName = repoNameForSlug(repo)

  const treeRes = await giteaFetch(
    `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repoName)}/git/trees/${encodeURIComponent(branch)}?recursive=true`,
    { method: 'GET' },
  )
  if (treeRes.status === 404) return null
  if (!treeRes.ok) throw new Error(`gitea fetchRepoFiles ${org}/${repoName} tree failed: ${treeRes.status}`)
  const tree = (await treeRes.json()) as GiteaTreeResponse

  const blobs = filterFetchableBlobs(tree.tree)

  const files: Record<string, string> = {}
  for (const blob of blobs) {
    try {
      const contentRes = await giteaFetch(
        `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repoName)}/contents/${encodeURIComponent(blob.path)}?ref=${encodeURIComponent(branch)}`,
        { method: 'GET' },
      )
      if (!contentRes.ok) continue
      const body = (await contentRes.json()) as { content?: string; encoding?: string }
      const decoded = decodeGiteaContent(body)
      if (decoded === null) continue
      files[blob.path] = decoded
    } catch {
      // A single file's fetch/decode failure (binary content, transient
      // network blip) must not fail the whole map — best-effort by design.
      continue
    }
  }
  return files
}
