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
 * Provision a REAL Instant DB project. Pass the founder's JWT to get a permanent
 * sk_ key immediately; omit it (anonymous) to get a tmp_ key + claim token.
 */
export async function provisionInstantDb(jwt?: string): Promise<InstantDbResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (jwt) headers.Authorization = `Bearer ${jwt}`
  try {
    const res = await fetch(`${AINATIVE_API}/api/v1/public/instant-db`, {
      method: 'POST',
      headers,
      // agree_terms is required by core (Issue #1227) — the founder accepts AINative
      // terms as part of shipping their company from /build.
      body: JSON.stringify({ agree_terms: true }),
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
    const isPermanent = apiKey.startsWith('sk_') || Boolean(jwt)
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
