/**
 * Per-company founder-credential store (#443) — durably holds the founder's
 * refreshable AINative credential for primitives that provision "one
 * resource per owner user" (ZeroCommerce confirmed via #417; ZeroPipeline/
 * AgentFlow/ZeroForms share the same shape). Those primitives have NO
 * separate service credential builder can hold after provisioning — the
 * resource is scoped to the founder's own AINative identity. A generated
 * app's runtime request therefore has to be proxied through a durably
 * refreshed copy of that identity's tokens, captured once at provision time.
 *
 * Storage: same ZeroDB REST pattern as app-registry.ts (append-only rows,
 * latest-wins on read) rather than the Postgres `deployment_credentials`
 * table — company slugs live in ZeroDB (builder_app_registry), and there is
 * no relational join between the two stores, so keeping this alongside the
 * registry avoids a second, disconnected system of record.
 *
 * Encryption: reuses credentials.service.ts's AES-256-GCM implementation
 * verbatim (same DEPLOYMENT_ENCRYPTION_KEY, same IV/auth-tag shape) rather
 * than a second crypto implementation for the same threat model.
 *
 * Refresh: refreshAINativeToken (lib/auth/tokenRefresh.ts) is a plain,
 * session-independent server call — POST {refresh_token} to
 * /api/v1/auth/refresh — so a stored refresh token can be rotated from any
 * server context (a proxy request, a cron), not only while the founder's
 * browser session is live. A refresh failure (401 = revoked/invalid) is
 * surfaced honestly; callers must fail closed, never retry indefinitely.
 */

import { encryptToken, decryptToken } from '@/lib/services/credentials.service'
import { refreshAINativeToken, shouldRefreshToken } from '@/lib/auth/tokenRefresh'
import { ainativeFetch } from '@/lib/ainative/client'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY || ''
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const TABLE = 'builder_primitive_credentials'

/** Primitives whose provisioning is scoped to the founder's own identity
 *  (confirmed "one resource per owner user" for ZeroCommerce via #417; the
 *  others share the same direct-JWT-bearer provisioning shape).
 *
 *  zerovoice (#522, closing the runtime-proxy gap #415 left open): ZeroVoice
 *  numbers are ALSO scoped to the founder's own AINative identity — same
 *  direct-JWT-bearer auth as the other 5 (confirmed via lib/build/zerovoice.ts's
 *  own doc comment: "Auth: same unified AINative founder JWT bearer used by
 *  zeropipeline.ts/zerocommerce.ts/zeroforms.ts/agentflow.ts"). Unlike those 5,
 *  its credential is captured at the EXPLICIT /api/build/zerovoice provisioning
 *  action (not the checkout-time provision/route.ts flow), since ZeroVoice is
 *  deliberately opt-in (real recurring cost, #415). */
export type FounderScopedPrimitive = 'zerocommerce' | 'zeropipeline' | 'agentflow' | 'zeroforms' | 'zerocrm' | 'zerovoice'

interface StoredCredentialRow {
  slug: string
  primitive: FounderScopedPrimitive
  encryptedToken: string
  iv: string
  authTag: string
  encryptedRefreshToken?: string
  refreshIv?: string
  refreshAuthTag?: string
  expiresAt?: number
  createdAt: string
  /**
   * The founder's real AINative organization_uuid (#414 — ZeroCRM support).
   * Not secret (a real, live org id, not a credential) so stored in plain
   * text alongside the encrypted tokens. ZeroCRM's get-or-create auth
   * (app/api/deps.py) needs this as an explicit ?org_id= query param — the
   * JWT itself only carries {sub, exp, type}, no org claim (confirmed via
   * direct decode), unlike ZeroCommerce/ZeroPipeline/AgentFlow/ZeroForms,
   * which resolve org scoping server-side from the JWT alone. Optional
   * because the other 4 primitives never need it.
   */
  organizationId?: string
}

function rowsUrl(): string {
  return `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${TABLE}/rows`
}
function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}
function configured(): boolean {
  return Boolean(API_KEY && PROJECT_ID)
}

/**
 * Ensure the credential table exists before writing to it — mirrors
 * `app/api/db/[table]/route.ts`'s `ensureTable` pattern exactly. Live-tested
 * this session: the table genuinely did not exist in production (a real
 * NOT_FOUND from ZeroDB, not a permissions issue), so every real call to
 * `storeFounderCredential` had been silently failing since #445 shipped —
 * `configured()` was true, the POST itself 404'd, and the catch-all swallowed
 * it into a quiet `false`. This call is best-effort and idempotent (ZeroDB
 * no-ops on an existing table), so it's safe to attempt on every write.
 */
/**
 * Fetch the founder's real AINative organization_uuid via GET /api/v1/auth/me
 * (#414 — ZeroCRM needs this as an explicit ?org_id=). Best-effort: returns
 * undefined on any failure rather than throwing, since this must never block
 * provisioning for the primitives that don't need it.
 */
export async function fetchOrganizationId(accessToken: string): Promise<string | undefined> {
  try {
    const me = await ainativeFetch<{ organization_uuid?: string }>('/api/v1/auth/me', accessToken, { method: 'GET' })
    return typeof me?.organization_uuid === 'string' && me.organization_uuid ? me.organization_uuid : undefined
  } catch {
    return undefined
  }
}

async function ensureTable(): Promise<void> {
  try {
    await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ table_name: TABLE }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // Table might already exist, or the create call itself failed — either
    // way, fall through to the real write and let ITS result be authoritative.
  }
}

/**
 * Store the founder's access + refresh token for a primitive, captured at
 * provision time (the founder's browser session is live then — the natural
 * capture point). Appends a row; latest wins on read, matching
 * app-registry.ts's pattern. Never throws — a storage failure means the
 * runtime proxy simply has nothing to serve later (fails closed, not open).
 */
export async function storeFounderCredential(
  slug: string,
  primitive: FounderScopedPrimitive,
  accessToken: string,
  refreshToken: string | undefined,
  expiresInSeconds: number | undefined,
  organizationId?: string,
): Promise<boolean> {
  if (!configured() || !slug || !primitive || !accessToken) return false
  try {
    await ensureTable()
    const access = encryptToken(accessToken)
    const refresh = refreshToken ? encryptToken(refreshToken) : null
    const row: StoredCredentialRow = {
      slug,
      primitive,
      encryptedToken: access.encryptedToken,
      iv: access.iv,
      authTag: access.authTag,
      ...(refresh
        ? { encryptedRefreshToken: refresh.encryptedToken, refreshIv: refresh.iv, refreshAuthTag: refresh.authTag }
        : {}),
      expiresAt: expiresInSeconds ? Date.now() + expiresInSeconds * 1000 : undefined,
      createdAt: new Date().toISOString(),
      ...(organizationId ? { organizationId } : {}),
    }
    const res = await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ row_data: row }),
      signal: AbortSignal.timeout(15000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Latest stored row for {slug, primitive}, or null if none/misconfigured. */
async function resolveStoredRow(slug: string, primitive: FounderScopedPrimitive): Promise<StoredCredentialRow | null> {
  if (!configured() || !slug || !primitive) return null
  try {
    const res = await fetch(`${rowsUrl()}?limit=1000`, { headers: headers(), signal: AbortSignal.timeout(20000) })
    if (!res.ok) return null
    const data = JSON.parse(await res.text())
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    const matches = rows
      .map((r: { row_data?: StoredCredentialRow }) => r.row_data)
      .filter((rd: StoredCredentialRow | undefined): rd is StoredCredentialRow =>
        rd?.slug === slug && rd?.primitive === primitive && !!rd?.encryptedToken)
    if (!matches.length) return null
    matches.sort((a: StoredCredentialRow, b: StoredCredentialRow) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    return matches[0]
  } catch {
    return null
  }
}

export interface ResolvedCredential {
  ok: boolean
  accessToken?: string
  reason?: 'not_provisioned' | 'decrypt_failed' | 'refresh_failed' | 'refresh_unavailable'
  /** The founder's AINative organization_uuid, when captured (ZeroCRM only). */
  organizationId?: string
}

/**
 * Resolve a live, usable AINative access token for {slug, primitive} — auto-
 * refreshing via the stored refresh token when the stored access token is
 * near/at expiry, and persisting the rotated pair back so future calls reuse
 * it. FAILS CLOSED: a decrypt failure, an unrefreshable expired token, or no
 * stored credential at all all return {ok:false}, never a stale/garbage
 * token. Never throws.
 */
export async function resolveFounderCredential(
  slug: string,
  primitive: FounderScopedPrimitive,
): Promise<ResolvedCredential> {
  const row = await resolveStoredRow(slug, primitive)
  if (!row) return { ok: false, reason: 'not_provisioned' }

  let accessToken: string
  try {
    accessToken = decryptToken({ encryptedToken: row.encryptedToken, iv: row.iv, authTag: row.authTag })
  } catch {
    return { ok: false, reason: 'decrypt_failed' }
  }

  if (!shouldRefreshToken(row.expiresAt)) {
    return { ok: true, accessToken, organizationId: row.organizationId }
  }

  // Near/at expiry — refresh using the stored refresh token. This call needs
  // no live founder session; refreshAINativeToken is a plain server call.
  if (!row.encryptedRefreshToken || !row.refreshIv || !row.refreshAuthTag) {
    // No refresh token was captured (e.g. the provider didn't issue one) —
    // the existing access token may still work until the caller actually
    // gets a 401 from the primitive itself; surface it rather than block.
    return { ok: true, accessToken, organizationId: row.organizationId }
  }

  let refreshToken: string
  try {
    refreshToken = decryptToken({
      encryptedToken: row.encryptedRefreshToken,
      iv: row.refreshIv,
      authTag: row.refreshAuthTag,
    })
  } catch {
    return { ok: false, reason: 'decrypt_failed' }
  }

  const refreshed = await refreshAINativeToken(refreshToken)
  if (!refreshed) {
    // Refresh token itself is invalid/revoked (founder disconnected, or it
    // rotated out from under us) — fail closed rather than retry the stale
    // access token, which would likely also 401.
    return { ok: false, reason: 'refresh_failed' }
  }

  await storeFounderCredential(
    slug,
    primitive,
    refreshed.accessToken,
    refreshed.refreshToken || refreshToken,
    refreshed.expiresIn,
    row.organizationId,
  )

  return { ok: true, accessToken: refreshed.accessToken, organizationId: row.organizationId }
}

/** Whether a founder credential has ever been stored for {slug, primitive} —
 *  cheap existence check for callers that just need to know before doing
 *  anything expensive (e.g. deciding whether to attempt provisioning). */
export async function hasFounderCredential(slug: string, primitive: FounderScopedPrimitive): Promise<boolean> {
  const row = await resolveStoredRow(slug, primitive)
  return row !== null
}
