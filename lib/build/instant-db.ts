/**
 * Instant DB provisioning client (#243).
 *
 * Instant DB is AINative's one-request per-company data layer:
 *   POST https://api.ainative.studio/api/v1/public/instant-db  (body { agree_terms: true })
 *
 *   - Anonymous            → tmp_ api_key, 72h expiry, returns a claim_url whose
 *                            ?token=… is the claim secret to later upgrade → permanent.
 *   - Authorization: Bearer <user JWT> → PERMANENT sk_ api_key, auto-assigned to the
 *                            user's Default Workspace. No claim needed.
 *
 * Response (verified live): { api_key, project_id, base_url, expires_at, claim_url, … }.
 * The raw claim token is embedded in claim_url as ?token=…&project=… (there is no
 * separate top-level `claim_token` field), so we parse it out here.
 */

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'

/** The Builder server's own AINative key (admin@ainative.studio identity). Owns the
 *  AINative Builder workspace, so it's the identity that can re-parent an
 *  admin-owned project into that workspace. */
const BUILDER_API_KEY = process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY || ''

/**
 * The AINative Builder workspace (core Organization) id — the single home for every
 * generated company/app project (#250). Defaults to the live Builder workspace
 * created 2026-08-21 (see docs/WORKSPACE_AND_PROVISIONING_ARCHITECTURE.md) so the
 * filing works even if the env var isn't set on a given deploy; override via
 * AINATIVE_BUILDER_WORKSPACE_ID.
 */
export const BUILDER_WORKSPACE_ID =
  process.env.AINATIVE_BUILDER_WORKSPACE_ID || '5d2376e1-d4f0-4193-9a7f-84e4543a8f9a'

/**
 * Trial window for an UNPAID (tmp_) Instant DB project, in milliseconds (72h).
 * Kept here as the single source of truth: Instant DB normally returns an
 * `expires_at`, but when it's missing/empty the provision route falls back to
 * `now + TRIAL_WINDOW_MS` so the Live "Free trial: Xh left" countdown always has
 * a real value (#260).
 */
export const TRIAL_WINDOW_MS = 72 * 60 * 60 * 1000

export interface InstantDbResult {
  ok: boolean
  projectId?: string
  /** 'tmp' for anonymous (72h) provisioning, 'permanent' for authenticated (sk_). */
  keyKind?: 'tmp' | 'permanent'
  /** Data-plane key (sk_/tmp_). Returned to the caller for server-side/secret use — NOT persisted in the shared registry. */
  apiKey?: string
  /** Claim secret for a tmp_ project, parsed from claim_url. Undefined for permanent. */
  claimToken?: string
  baseUrl?: string
  expiresAt?: string
  reason?: string
  status?: number
}

/** Extract the raw claim token from an Instant DB claim_url (?token=…). */
export function parseClaimToken(claimUrl?: string): string | undefined {
  if (!claimUrl) return undefined
  try {
    const u = new URL(claimUrl)
    return u.searchParams.get('token') || undefined
  } catch {
    // Fall back to a regex if it isn't a full URL for some reason.
    const m = /[?&]token=([^&]+)/.exec(claimUrl)
    return m ? decodeURIComponent(m[1]) : undefined
  }
}

/**
 * Provision a REAL Instant DB project.
 *
 * Policy (#207): a PERMANENT (sk_) key requires a PAID subscription. Pass
 * `permanent: true` (only when the founder has paid) together with their JWT to
 * mint a permanent sk_ key immediately. Otherwise — anonymous OR signed-in-but-
 * unpaid — we provision UNAUTHENTICATED to get a tmp_ key (72h) + a claim token,
 * which the post-payment flow upgrades to permanent. We deliberately do NOT send
 * the JWT for a non-permanent provision, since an authenticated Instant DB call
 * would otherwise return a permanent key to an unpaid user.
 */
export async function provisionInstantDb(
  jwt?: string,
  permanent = false,
): Promise<InstantDbResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // Only attach the JWT when we intend a permanent key (paid). Unpaid → tmp_.
  if (jwt && permanent) headers.Authorization = `Bearer ${jwt}`
  try {
    const res = await fetch(`${AINATIVE_API}/api/v1/public/instant-db`, {
      method: 'POST',
      headers,
      // agree_terms is required by core (Issue #1227) — the founder accepts AINative
      // terms as part of shipping their company from /build.
      //
      // workspace_id (#250): ask core to file the new project directly under the
      // AINative Builder workspace. Core doesn't honor this field YET (tracked in
      // core PR #6460 / core#6395); it's forward-compatible — once core reads it,
      // no re-parent step is needed. Until then, the provision route best-effort
      // re-parents via fileProjectUnderBuilderWorkspace() (admin-owned projects).
      body: JSON.stringify({ agree_terms: true, workspace_id: BUILDER_WORKSPACE_ID }),
      signal: AbortSignal.timeout(30000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.project_id) {
      return {
        ok: false,
        status: res.status,
        reason: String(data?.detail || data?.error_code || res.status).slice(0, 200),
      }
    }
    const apiKey = String(data.api_key || '')
    // Permanent iff core actually returned an sk_ key (we only request that when
    // `permanent` is set for a paid user). A tmp_ key is never treated as permanent.
    const isPermanent = apiKey.startsWith('sk_')
    return {
      ok: true,
      projectId: String(data.project_id),
      keyKind: isPermanent ? 'permanent' : 'tmp',
      apiKey,
      claimToken: isPermanent ? undefined : parseClaimToken(data.claim_url),
      baseUrl: String(data.base_url || AINATIVE_API),
      expiresAt: data.expires_at ? String(data.expires_at) : undefined,
      status: res.status,
    }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}

export interface FileWorkspaceResult {
  /** true iff the project's organization_id now equals the Builder workspace. */
  filed: boolean
  /** true iff it was already under the Builder workspace (idempotent no-op). */
  alreadyFiled?: boolean
  status?: number
  reason?: string
}

/**
 * File an already-provisioned ZeroDB project under the AINative Builder workspace (#250).
 *
 * Instant DB currently drops a new project into the *creating identity's* default
 * workspace (for the Builder key that's "AINative Studio", not "AINative Builder"),
 * and does not yet honor the `workspace_id` we send on create. Until core honors it
 * (core PR #6460), this re-parents the project via `PATCH /api/v1/projects/{id}`
 * with `organization_id = BUILDER_WORKSPACE_ID`.
 *
 * Auth: uses the Builder's own admin key (BUILDER_API_KEY). This only succeeds for
 * projects OWNED by that identity — i.e. PERMANENT (paid) provisions minted with the
 * Builder key. tmp_ trial projects (anonymous provision) are NOT admin-owned, so this
 * is a best-effort no-op for them (they get re-parented after being claimed, when the
 * project is associated to the paying account, or once core honors workspace_id).
 *
 * Best-effort + non-throwing: the caller must never fail provisioning because filing
 * didn't stick. Returns a structured result so the route can log the outcome.
 *
 * NOTE (2026-08-22): core's project PATCH currently 500s on an unrelated
 * `audit_logs.organization_id` UndefinedColumn schema bug; this helper surfaces that
 * as `{ filed:false, status:500 }` rather than throwing. Once the core schema/instant-db
 * fix lands, filing succeeds with no Builder change.
 */
export async function fileProjectUnderBuilderWorkspace(
  projectId: string,
  opts: { workspaceId?: string; apiKey?: string } = {},
): Promise<FileWorkspaceResult> {
  const workspaceId = opts.workspaceId || BUILDER_WORKSPACE_ID
  const apiKey = opts.apiKey || BUILDER_API_KEY
  if (!projectId) return { filed: false, reason: 'no_project_id' }
  if (!apiKey) return { filed: false, reason: 'no_api_key' }
  if (!workspaceId) return { filed: false, reason: 'no_workspace_id' }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'X-API-Key': apiKey,
    'Content-Type': 'application/json',
  }
  try {
    // Skip the PATCH if it's already home (idempotent, and avoids the audit_logs
    // write path on a no-op).
    const cur = await fetch(`${AINATIVE_API}/api/v1/projects/${projectId}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15000),
    })
    if (cur.ok) {
      const p = await cur.json().catch(() => null)
      if (p?.organization_id === workspaceId) {
        return { filed: true, alreadyFiled: true, status: cur.status }
      }
    }

    const res = await fetch(`${AINATIVE_API}/api/v1/projects/${projectId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ organization_id: workspaceId }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      return { filed: false, status: res.status, reason: String(data?.detail || res.status).slice(0, 200) }
    }
    return { filed: true, status: res.status }
  } catch (e: any) {
    return { filed: false, reason: String(e?.message || e).slice(0, 160) }
  }
}
