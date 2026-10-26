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

/**
 * Default per-call timeout (ms). Gitea create ops are fast; keep them
 * time-boxed. Bumped from 15s (#698 follow-up) — a real chat-triggered edit
 * call chains several of these sequentially (getBranch pre-flight,
 * getDefaultBranchSha, create branch, push files, re-fetch branch, create
 * PR), and 15s per call was tight enough that a live production request
 * genuinely hit "operation was aborted due to timeout" on ordinary Gitea
 * latency, not a hung/broken call. Matches task-git-sync.ts's own 30s.
 */
const TIMEOUT_MS = 30000

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
 * Transfer a repo to a different org (#1545 — migrating repos provisioned
 * before #1543/#1544 out of the single shared platform org into their real
 * founder's own workspace org). Real, documented Gitea contract: `POST
 * /repos/{owner}/{repo}/transfer` with `{new_owner}` — Gitea executes org-to-
 * org repo transfers synchronously (no pending-invite step when the new
 * owner is an org the admin token already controls, which every `ws-*` org
 * this client creates always is), returning the repo's updated representation
 * under its new `full_name`.
 *
 * IDEMPOTENT in the same spirit as ensureOrg/createRepo: if the repo is
 * already under `toOrg` (checked via a pre-flight getRepo), this is a no-op
 * success rather than an error — a migration script re-run after a partial
 * failure must never fail on the rows it already fixed. Returns null when
 * unconfigured or inputs are invalid, OR when the source repo genuinely
 * doesn't exist under `fromOrg` (a 404 there is a real "nothing to
 * transfer," not a failure to surface). THROWS on any other non-ok status
 * (auth/server error, or Gitea refusing the transfer for a reason this
 * caller should see, e.g. a name collision in the destination org).
 */
export async function transferRepo(
  fromOrg: string,
  toOrg: string,
  slug: string,
): Promise<GiteaRepo | null> {
  if (!configured() || !fromOrg || !toOrg) return null
  const repo = repoNameForSlug(slug)
  if (!repo) return null

  // Already there (a prior run got this far, or it was never actually in
  // fromOrg to begin with) → idempotent no-op.
  const already = await getRepo(toOrg, repo)
  if (already) return already

  const existing = await getRepo(fromOrg, repo)
  if (!existing) return null

  const res = await giteaFetch(
    `/repos/${encodeURIComponent(fromOrg)}/${encodeURIComponent(repo)}/transfer`,
    { method: 'POST', body: JSON.stringify({ new_owner: toOrg }) },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`gitea transferRepo ${fromOrg}/${repo} -> ${toOrg} failed: ${res.status} ${text}`.slice(0, 300))
  }
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
 * A minimal webhook reference returned by Gitea's hooks API.
 *
 * Confirmed live against the real Gitea instance's own swagger spec
 * (git.ainative.studio/swagger.v1.json, same instance every other *live
 * confirmed* comment in this file already validated against) — `Hook.config`
 * is a free-form `map[string]string` (NOT a typed object), so the webhook's
 * target URL comes back as `config.url` (a plain string key), same key name
 * `CreateHookOptionConfig` accepts on create.
 */
export interface GiteaHook {
  id: number
  type: string
  config: { url?: string; content_type?: string; secret?: string; [k: string]: string | undefined }
  events: string[]
  active: boolean
}

/**
 * List webhooks configured on a repo. Returns [] when unconfigured, the repo
 * doesn't exist (404), or on any other failure — this is a read used only for
 * an idempotent pre-flight check (createRepoWebhook) and a backfill script's
 * verification step, so a transient read failure degrading to "no hooks
 * found" (and therefore attempting a create, which itself is safe to retry)
 * is the right default rather than throwing and blocking the caller.
 */
export async function getRepoWebhooks(org: string, repo: string): Promise<GiteaHook[]> {
  if (!configured() || !org || !repo) return []
  const repoName = repoNameForSlug(repo)
  if (!repoName) return []
  try {
    const res = await giteaFetch(
      `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repoName)}/hooks`,
      { method: 'GET' },
    )
    if (!res.ok) return []
    const hooks = (await res.json()) as GiteaHook[]
    return Array.isArray(hooks) ? hooks : []
  } catch {
    return []
  }
}

/**
 * Register the Builder webhook on a company repo (#1092) — this is the piece
 * that was missing entirely: `docs/GITEA_PROVISIONING.md` documented webhook
 * setup as a one-time MANUAL admin-panel step, but that manual step never
 * actually happened for any real company repo, so `app/api/webhooks/gitea/
 * route.ts` (the committee PR gate + #1091's build_tasks sync) was silently
 * never called in production — no repo ever had a hook pointed at it.
 *
 * IDEMPOTENT, following the exact ensureOrg/createRepo pattern in this same
 * file: a pre-flight GET (getRepoWebhooks) checks for an existing hook whose
 * `config.url` already matches `targetUrl` before creating a new one, so a
 * re-run (new-repo provisioning calling this again, or the backfill script
 * run twice) never creates a duplicate.
 *
 * Real, confirmed Gitea contract (git.ainative.studio/swagger.v1.json,
 * `CreateHookOption`/`CreateHookOptionConfig`): `POST /repos/{owner}/{repo}/
 * hooks` with `{type: 'gitea', config: {url, content_type, secret}, events,
 * active}` — `type` must be one of a fixed enum Gitea publishes
 * ('gitea'/'gogs'/'slack'/etc.); 'gitea' is its own native webhook format,
 * matching what `app/api/webhooks/gitea/route.ts` already parses
 * (GiteaWebhookPayload / GiteaPushPayload shapes).
 *
 * NEVER THROWS — deliberately more lenient than ensureOrg/createRepo's "throw
 * on genuine failure" policy. Per #1092 and this file's own resilience
 * philosophy (see createIssue/listIssues above): the webhook is valuable but
 * secondary to the repo existing at all. A hiccup creating it (auth blip,
 * Gitea transient 500) must never fail `provisionCompanyRepo` and block a
 * founder's company from getting its repo — the result's `ok:false` lets a
 * caller log/alert on it without surfacing a user-facing provisioning error.
 */
export async function createRepoWebhook(
  org: string,
  repo: string,
  targetUrl: string,
  secret: string,
): Promise<{ ok: boolean; hook?: GiteaHook; reason?: string }> {
  if (!configured()) return { ok: false, reason: 'not_configured' }
  if (!org) return { ok: false, reason: 'no_org' }
  const repoName = repoNameForSlug(repo)
  if (!repoName) return { ok: false, reason: 'no_repo' }
  const url = String(targetUrl || '').trim()
  if (!url) return { ok: false, reason: 'no_target_url' }

  try {
    // Pre-flight: a hook already pointed at this exact URL → idempotent no-op.
    const existing = await getRepoWebhooks(org, repoName)
    const match = existing.find((h) => h.config?.url === url)
    if (match) return { ok: true, hook: match }

    const res = await giteaFetch(
      `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repoName)}/hooks`,
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'gitea',
          config: {
            url,
            content_type: 'json',
            secret: secret || '',
          },
          events: ['push', 'pull_request'],
          active: true,
        }),
      },
    )
    if (res.status === 409) {
      // Raced create (another request registered it concurrently) — re-fetch.
      const raced = await getRepoWebhooks(org, repoName)
      const racedMatch = raced.find((h) => h.config?.url === url)
      if (racedMatch) return { ok: true, hook: racedMatch }
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, reason: `gitea createRepoWebhook ${org}/${repoName} failed: ${res.status} ${text}`.slice(0, 300) }
    }
    const hook = (await res.json()) as GiteaHook
    return { ok: true, hook }
  } catch (e) {
    return { ok: false, reason: `createRepoWebhook threw: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) }
  }
}

/**
 * Builder's own repo-topic marker (#1531). Stamped on every provisioned
 * company repo so ANY agent or human — in this codebase or a completely
 * different one — can answer "is this Builder's?" via a single read-only
 * API call (`GET /repos/search?topic=ainative-builder`, the exact endpoint
 * a peer session already used while investigating an unrelated repo and
 * couldn't self-verify ownership for, having to ask across sessions
 * instead). The free-text `description` createRepo() already sets
 * ("AINative company: {slug}") identifies the COMPANY but not the fact
 * that Builder specifically owns/provisioned the repo, and isn't
 * machine-filterable the way a topic is.
 */
export const BUILDER_REPO_TOPIC = 'ainative-builder'

/**
 * Replace a repo's topic list with Builder's own marker (idempotent — Gitea's
 * PUT topics endpoint is a full replace, and re-setting the same single topic
 * is a no-op 204 either way). Best-effort, same shape/convention as
 * createRepoWebhook: a topic hiccup must never block the repo itself (the
 * more critical half of provisioning) from being created or used.
 */
export async function setRepoTopics(
  org: string,
  repo: string,
  topics: string[] = [BUILDER_REPO_TOPIC],
): Promise<{ ok: boolean; reason?: string }> {
  if (!configured()) return { ok: false, reason: 'not_configured' }
  if (!org) return { ok: false, reason: 'no_org' }
  const repoName = repoNameForSlug(repo)
  if (!repoName) return { ok: false, reason: 'no_repo' }

  try {
    const res = await giteaFetch(
      `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repoName)}/topics`,
      { method: 'PUT', body: JSON.stringify({ topics }) },
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, reason: `gitea setRepoTopics ${org}/${repoName} failed: ${res.status} ${text}`.slice(0, 300) }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: `setRepoTopics threw: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) }
  }
}

/** The Builder route Gitea webhooks POST to — same convention every other
 *  module deriving the app's own public URL already uses (lib/build/deploy.ts,
 *  comms-policy.ts, winback-email.ts, etc: `NEXT_PUBLIC_APP_URL` with a
 *  `https://builder.ainative.studio` fallback). Exported so the backfill
 *  script (scripts/backfill-gitea-webhooks.ts) derives the identical target
 *  URL rather than re-deriving its own and risking drift. */
export function webhookTargetUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio').replace(/\/+$/, '')
  return `${base}/api/webhooks/gitea`
}

/**
 * One-shot provision helper: ensure the workspace org, then the company's private
 * repo, then (#1092) register the Builder webhook on it so Gitea actually calls
 * back into the committee PR gate / build_tasks sync (#1091) for this repo's PRs
 * and pushes. Returns { org, repo } or null when unconfigured / inputs invalid.
 * This is the seam the build/deploy pipeline calls; persistence of the resulting
 * repo URL/id onto the AppEntry is done by the caller via setAppGitRepo
 * (lib/build/app-registry).
 *
 * The webhook and topic steps never block or fail this function (see
 * createRepoWebhook's / setRepoTopics's own docs) — a hiccup on either is
 * logged to console, never thrown, so a transient Gitea issue can never
 * prevent a company's repo (the more critical half of provisioning) from
 * being created.
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

  const hookResult = await createRepoWebhook(
    org.username,
    repo.name,
    webhookTargetUrl(),
    process.env.GITEA_WEBHOOK_SECRET || '',
  )
  if (!hookResult.ok) {
    console.error(`[gitea] createRepoWebhook failed for ${org.username}/${repo.name}: ${hookResult.reason}`)
  }

  // #1531 — stamp the Builder-ownership topic so this repo is self-identifying
  // via Gitea's own search API, not just a human/agent asking across sessions.
  const topicResult = await setRepoTopics(org.username, repo.name)
  if (!topicResult.ok) {
    console.error(`[gitea] setRepoTopics failed for ${org.username}/${repo.name}: ${topicResult.reason}`)
  }

  return { org, repo }
}

// ---------------------------------------------------------------------------
// Branch operations (#356 GIT-3 — task→branch mapping)
// ---------------------------------------------------------------------------

/**
 * A minimal branch reference returned by Gitea.
 *
 * Real bug found live (#582 investigation): Gitea's actual branches API
 * response shape (confirmed directly, GET /repos/{org}/{repo}/branches/main
 * against production) nests the commit hash under `commit.id`, NOT
 * `commit.sha` — every read of `.commit.sha` below was silently returning
 * undefined, always. getDefaultBranchSha in particular used this as the
 * REAL base ref for every task-branch creation call, so createTaskBranch
 * (and therefore the entire task-resolver.ts pipeline the nightly loop
 * ALSO depends on) had never actually succeeded creating a branch against
 * an existing repo — it always fell through to `if (!defaultSha) return null`.
 */
export interface GiteaBranch {
  name: string
  commit: { id: string; sha?: string; url?: string }
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
    return master.commit?.id || master.commit?.sha || null
  }
  if (!res.ok) return null
  const branch = (await res.json()) as GiteaBranch
  return branch.commit?.id || branch.commit?.sha || null
}

/**
 * Create a branch for a task. PURE naming: task/{taskId}, or
 * task/{issueNumber}-{taskId} when `issueNumber` is given (#907). IDEMPOTENT —
 * returns the existing branch if present. Returns null when unconfigured.
 * THROWS on genuine failures.
 */
export async function createTaskBranch(
  org: string,
  repo: string,
  taskId: string,
  baseSha?: string,
  issueNumber?: number | null,
): Promise<GiteaBranch | null> {
  if (!configured() || !org || !repo || !taskId) return null
  const repoName = repoNameForSlug(repo)
  const branchName = taskBranchName(taskId, issueNumber)

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
 * Derive the branch name for a task. PURE. Format: task/{taskId}, or
 * task/{issueNumber}-{taskId} when a real Gitea issue number is given (#907 —
 * mirrors the documented `[type]/[issue-number]-[slug]` branch convention,
 * adapted to this module's existing `task/{taskId}` naming rather than
 * inventing a new type prefix). Sanitizes the taskId to be a valid git
 * branch name.
 *
 * `issueNumber` is optional and falls back to today's `task/{taskId}` format
 * when omitted, null, or not a positive finite integer (#907 — a task with no
 * issue yet, e.g. a pre-#905 row or a failed issue-open attempt, must never
 * produce a malformed branch reference like `task/NaN-t1`).
 */
export function taskBranchName(taskId: string, issueNumber?: number | null): string {
  const clean = String(taskId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  if (!clean) return ''
  const validIssue = Number.isFinite(issueNumber) && (issueNumber as number) > 0
  return validIssue ? `task/${issueNumber}-${clean}` : `task/${clean}`
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
  /**
   * Whether the PR was merged (#1086 — confirmed present on the real Gitea
   * PR object via the live swagger spec at git.ainative.studio/swagger.v1.json,
   * alongside `merged_at`). Optional because this field is absent from a few
   * older callers' own minimal literal objects in this codebase (e.g. tests
   * constructing a bare `{}` pull_request) — never assume it's set.
   */
  merged?: boolean
}

/**
 * Create a pull request from a task branch to main. IDEMPOTENT — if a PR already
 * exists for this head→base, returns it. Returns null when unconfigured.
 * THROWS on genuine failures.
 *
 * `issueNumber` (#907), when given, must be the SAME value passed to
 * createTaskBranch for this task — it only affects which head branch this PR
 * is opened from (taskBranchName derives the branch name identically from
 * taskId + issueNumber), so a mismatch here would look for/create the wrong
 * branch entirely.
 */
export async function createTaskPR(
  org: string,
  repo: string,
  opts: {
    taskId: string
    title: string
    body?: string
    baseBranch?: string
    issueNumber?: number | null
  },
): Promise<GiteaPullRequest | null> {
  if (!configured() || !org || !repo || !opts.taskId) return null
  const repoName = repoNameForSlug(repo)
  const headBranch = taskBranchName(opts.taskId, opts.issueNumber)
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
// Commit activity (#743 — pair-programming comms digest)
// ---------------------------------------------------------------------------

/** A minimal commit reference returned by Gitea's commit-list endpoint. */
export interface GiteaCommit {
  sha: string
  html_url: string
  commit: {
    message: string
    author: { name?: string; email?: string; date?: string }
    committer: { name?: string; email?: string; date?: string }
  }
}

/**
 * Default page size when paginating getCommitsSince(). Kept small — a daily
 * digest only needs recent activity, not a repo's full history, and each
 * page is a real network round-trip.
 */
const COMMITS_PAGE_SIZE = 50
/** Hard cap on pages fetched per call, so a pathologically busy repo (or a
 *  `sinceIso` far in the past) can't hang the digest cron. */
const MAX_COMMITS_PAGES = 10

/**
 * List commits on the default branch at/after `sinceIso` (#743, pair-
 * programming digest). Returns [] when unconfigured, the repo doesn't exist
 * (404), or the repo is empty (409 — Gitea's real EmptyRepository response for
 * a freshly auto-inited repo with no commits yet) — a company with a
 * provisioned-but-still-empty repo is a normal state, not an error.
 * THROWS on a genuine API failure (auth/server error) so a real outage is
 * visible rather than silently read as "no activity."
 *
 * VERIFIED LIVE (2026-09-14) against the real Gitea instance at
 * git.ainative.studio (version 1.22.6, confirmed via GET /api/v1/version and
 * the real swagger spec at /swagger.v1.json): unlike GitHub's commits API,
 * Gitea's `GET /repos/{owner}/{repo}/commits` has NO `since`/`until` query
 * parameter at all — the only filters are `sha` (branch/ref), `path`, `page`,
 * `limit`, and `not`. So this does the filtering CLIENT-SIDE: it pages through
 * commits (newest-first, Gitea's default order) with `stat=false&
 * verification=false&files=false` (speedup flags the swagger spec documents,
 * since a digest only needs sha/message/author/date), stopping as soon as it
 * sees a commit strictly OLDER than `sinceIso` — no need to page through the
 * repo's full history for a delta that's usually a handful of commits.
 */
export async function getCommitsSince(
  org: string,
  repo: string,
  sinceIso: string,
): Promise<GiteaCommit[]> {
  if (!configured() || !org || !repo || !sinceIso) return []
  const repoName = repoNameForSlug(repo)
  const sinceMs = Date.parse(sinceIso)
  if (Number.isNaN(sinceMs)) return []

  const results: GiteaCommit[] = []
  for (let page = 1; page <= MAX_COMMITS_PAGES; page++) {
    const res = await giteaFetch(
      `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repoName)}/commits` +
        `?stat=false&verification=false&files=false&page=${page}&limit=${COMMITS_PAGE_SIZE}`,
      { method: 'GET' },
    )
    if (res.status === 404) return []
    // 409 = EmptyRepository (Gitea's real response for a repo with no commits yet).
    if (res.status === 409) return []
    if (!res.ok) throw new Error(`gitea getCommitsSince ${org}/${repoName} failed: ${res.status}`)
    const commits = (await res.json()) as GiteaCommit[]
    if (!Array.isArray(commits) || commits.length === 0) break

    let hitOlder = false
    for (const c of commits) {
      const dateStr = c.commit?.author?.date || c.commit?.committer?.date
      const ts = dateStr ? Date.parse(dateStr) : NaN
      if (!Number.isNaN(ts) && ts < sinceMs) {
        hitOlder = true
        break
      }
      results.push(c)
    }
    if (hitOlder || commits.length < COMMITS_PAGE_SIZE) break
  }
  return results
}

// ---------------------------------------------------------------------------
// Issue creation (#744 — inbound SMS → real Gitea issue)
// ---------------------------------------------------------------------------

/** A minimal issue reference returned by Gitea's issue-creation endpoint. */
export interface GiteaIssue {
  id: number
  number: number
  title: string
  body?: string
  state: string
  html_url: string
}

/** Honest result of createIssue — never throws (see createIssue's doc). */
export interface CreateIssueResult {
  ok: boolean
  issueNumber?: number
  url?: string
  reason?: string
}

/**
 * Create an issue in a company's Gitea repo (#744 — a founder texts Cody a
 * quick feature idea while on the go, and it becomes a real tracked issue).
 *
 * Real, confirmed contract (checked directly against the live git.ainative.studio
 * instance's own swagger spec, version 1.22.6 — same instance getCommitsSince()
 * above already verified live): `POST /repos/{owner}/{repo}/issues` takes a
 * `CreateIssueOption` body. Unlike GitHub's issues API, Gitea's real schema
 * takes `labels` as an array of INTEGER label IDs (not strings) — this
 * function deliberately does not support labels at all, to avoid a caller
 * passing string labels that would silently fail Gitea's validation. The
 * created issue is returned with the standard Gitea `Issue` shape — the
 * fields we surface here (id/number/title/body/state/html_url) are the same
 * subset every other *Issue/*PullRequest type in this file already exposes.
 *
 * Mirrors createRepo/createTaskPR's own style exactly: never throws — any
 * failure (unconfigured, invalid input, non-ok response, thrown network
 * error) surfaces as an honest `{ok:false, reason}` so a caller on an
 * autonomous/webhook path (the #744 SMS-to-issue webhook) can degrade
 * gracefully instead of crashing the request that triggered it.
 *
 * NOT idempotent by design — Gitea's issues API has no natural dedupe key
 * (unlike a branch name or a PR's head→base pair), and a caller retrying
 * after a failure should get a fresh honest attempt rather than this client
 * silently swallowing a possible duplicate-detection responsibility it can't
 * actually fulfill correctly.
 */
export async function createIssue(
  org: string,
  repo: string,
  title: string,
  body: string,
): Promise<CreateIssueResult> {
  if (!configured()) return { ok: false, reason: 'not_configured' }
  if (!org) return { ok: false, reason: 'no_org' }
  const repoName = repoNameForSlug(repo)
  if (!repoName) return { ok: false, reason: 'no_repo' }
  const cleanTitle = String(title || '').trim()
  if (!cleanTitle) return { ok: false, reason: 'no_title' }

  try {
    const res = await giteaFetch(
      `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repoName)}/issues`,
      {
        method: 'POST',
        body: JSON.stringify({ title: cleanTitle, body: body || '' }),
      },
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, reason: `gitea createIssue ${org}/${repoName} failed: ${res.status} ${text}`.slice(0, 300) }
    }
    const issue = (await res.json()) as GiteaIssue
    if (!issue?.number) return { ok: false, reason: 'create_response_missing_number' }
    return { ok: true, issueNumber: issue.number, url: issue.html_url }
  } catch (e) {
    return { ok: false, reason: `createIssue threw: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) }
  }
}

export interface ListIssuesResult {
  ok: boolean
  issues?: GiteaIssue[]
  reason?: string
}

/**
 * List issues in a company's Gitea repo (#774, Gap 2 — grounding Cody's
 * "I'll wire that" / "it's in the queue" claims in the founder's own REAL
 * backlog instead of a synthetic, always-the-same list). Real, confirmed
 * contract: `GET /repos/{owner}/{repo}/issues?state={state}&limit={limit}`
 * (same Gitea instance/version as createIssue above). Sorted by Gitea's own
 * default (most-recently-updated first), which is what "recently closed" /
 * "currently open" framing needs.
 *
 * Mirrors createIssue's contract exactly: never throws — any failure
 * (unconfigured, no repo, non-ok response, thrown network error) surfaces as
 * an honest `{ok:false, reason}` so a caller building a system-prompt
 * grounding block can degrade to "no real backlog data" rather than crash
 * the whole chat turn.
 */
export async function listIssues(
  org: string,
  repo: string,
  opts?: { state?: 'open' | 'closed' | 'all'; limit?: number },
): Promise<ListIssuesResult> {
  if (!configured()) return { ok: false, reason: 'not_configured' }
  if (!org) return { ok: false, reason: 'no_org' }
  const repoName = repoNameForSlug(repo)
  if (!repoName) return { ok: false, reason: 'no_repo' }

  const state = opts?.state || 'all'
  const limit = Math.min(Math.max(1, opts?.limit ?? 20), 50)

  try {
    const res = await giteaFetch(
      `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repoName)}/issues?state=${state}&limit=${limit}&type=issues`,
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, reason: `gitea listIssues ${org}/${repoName} failed: ${res.status} ${text}`.slice(0, 300) }
    }
    const issues = (await res.json()) as GiteaIssue[]
    return { ok: true, issues: Array.isArray(issues) ? issues : [] }
  } catch (e) {
    return { ok: false, reason: `listIssues threw: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) }
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
