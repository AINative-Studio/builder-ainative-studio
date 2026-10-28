/**
 * Per-company ZeroDB data-plane key store (#806/#844).
 *
 * THE BUG THIS EXISTS TO FIX (confirmed live against production, both
 * directions): every `/api/db/{table}` call (GET/POST/PUT/DELETE) and
 * `visitor-metrics.ts`'s `countVisitors()` used ONE shared, service-wide
 * `ZERODB_API_KEY` to talk to a COMPANY'S OWN per-company ZeroDB project.
 * That key is scoped to Builder's own registry project, NOT to arbitrary
 * per-company projects, so ZeroDB answered every such call with:
 *
 *   403 {"detail":"This API key is not scoped to this project",
 *        "error_code":"API_KEY_PROJECT_MISMATCH"}
 *
 * Reads (the visitor count) failed toward 0, and writes (a real waitlist
 * signup) hard-failed while the generated app's own codegen pattern
 * (`await fetch(...).catch(() => {}); setSubmitted(true)` — see
 * primitive-catalog.ts's EMAIL/WAITLIST CAPTURE block) swallowed the 403 and
 * showed a confident fake "You're on the list." A real founder's real lead was
 * never persisted anywhere.
 *
 * The right key already exists and was being thrown away: `provisionInstantDb`
 * (lib/build/instant-db.ts) returns a real, project-scoped `sk_`/`tmp_`
 * api_key for the project it just minted, and provision/route.ts's own doc
 * comment notes it is deliberately NOT written into the shared registry. This
 * module is where it now lives instead.
 *
 * Storage/encryption: deliberately mirrors lib/build/primitive-credentials.ts
 * verbatim — same ZeroDB REST append-only rows / latest-wins read, same
 * AES-256-GCM encryptToken/decryptToken from lib/services/credentials-crypto,
 * same trust boundary. It is a SEPARATE table from `builder_app_registry` on
 * purpose: the registry is read broadly across the codebase and returns whole
 * rows, so a raw data-plane secret there would be a real exposure.
 *
 * Keyed by ZeroDB projectId (not slug): the consumers that need it
 * (`/api/db/[table]`'s signed per-app data token, `countVisitors`) only ever
 * hold a projectId, and the projectId is the thing the key is actually scoped
 * to. `slug` is stored alongside for operability/debugging only.
 *
 * FAIL-CLOSED: resolve returns a structured {ok:false, reason} — never the
 * shared key — when no key was stored or decryption fails. Falling back to the
 * shared key against someone else's project is exactly the cross-tenant
 * mis-scoping this fixes, and would re-introduce the silent 403.
 */

// Import the PURE crypto helpers, not credentials.service, which statically
// pulls in the drizzle/Postgres chain (~3.5s of Vite transform) that this
// module has no use for -- see lib/services/credentials-crypto.ts (#1489).
import { encryptToken, decryptToken } from '@/lib/services/credentials-crypto'
import { getAinativeApiKey } from '@/lib/build/env-keys'
import { TRIAL_WINDOW_MS } from '@/lib/build/instant-db'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const TABLE = 'builder_company_zerodb_keys'

/** Builder's OWN registry project + shared service key — the store lives here,
 *  which the shared key IS correctly scoped to. Read lazily (not at module
 *  load) so tests and env changes are observed. */
function registryProjectId(): string {
  return process.env.ZERODB_PROJECT_ID || ''
}
function serviceKey(): string {
  return getAinativeApiKey()
}
function configured(): boolean {
  return Boolean(serviceKey() && registryProjectId())
}
function rowsUrl(): string {
  return `${AINATIVE_API}/api/v1/projects/${registryProjectId()}/database/tables/${TABLE}/rows`
}
function headers(): Record<string, string> {
  const key = serviceKey()
  return { Authorization: `Bearer ${key}`, 'X-API-Key': key, 'Content-Type': 'application/json' }
}

interface StoredZerodbKeyRow {
  /** The ZeroDB project this key is scoped to — the lookup key. */
  projectId: string
  /** Company slug, for operability only (never the lookup key). */
  slug?: string
  /** 'permanent' (sk_) or 'tmp' (~24h trial, #1579/#1602) — mirrors InstantDbResult.keyKind. */
  keyKind?: 'tmp' | 'permanent'
  /**
   * The REAL expiry core returned at mint time (InstantDbResult.expiresAt,
   * #1602) — not a fixed window. Optional: rows stored before this field
   * existed have none, and fall back to TRIAL_WINDOW_MS in
   * resolveCompanyZerodbKey, same as before.
   */
  expiresAt?: string
  encryptedKey: string
  iv: string
  authTag: string
  createdAt: string
}

/**
 * Ensure the table exists before writing — same best-effort, idempotent
 * pattern as primitive-credentials.ts's ensureTable (which was added after a
 * real live incident where every write silently 404'd against a table that
 * had never been created).
 */
async function ensureTable(): Promise<void> {
  try {
    await fetch(`${AINATIVE_API}/api/v1/projects/${registryProjectId()}/database/tables`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ table_name: TABLE }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // Already exists, or the create itself failed — let the real write below
    // be authoritative rather than guessing here.
  }
}

/**
 * Persist the project-scoped data-plane key minted for a company's own ZeroDB
 * project. Append-only; latest row wins on read (matches app-registry.ts and
 * primitive-credentials.ts). Never throws — a storage failure means the
 * runtime simply has no key to serve later and fails closed, which is the
 * honest outcome, not a silent shared-key fallback.
 *
 * Returns true only on a real, confirmed write.
 */
export async function storeCompanyZerodbKey(
  projectId: string,
  apiKey: string,
  options: { slug?: string; keyKind?: 'tmp' | 'permanent'; expiresAt?: string } = {},
): Promise<boolean> {
  if (!configured() || !projectId || !apiKey) return false
  try {
    await ensureTable()
    const enc = encryptToken(apiKey)
    const row: StoredZerodbKeyRow = {
      projectId,
      ...(options.slug ? { slug: options.slug } : {}),
      ...(options.keyKind ? { keyKind: options.keyKind } : {}),
      ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
      encryptedKey: enc.encryptedToken,
      iv: enc.iv,
      authTag: enc.authTag,
      createdAt: new Date().toISOString(),
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

export interface ResolvedZerodbKey {
  ok: boolean
  apiKey?: string
  /**
   * Why resolution failed. 'not_stored' is the expected case for a company
   * provisioned before this fix shipped (#806) — it must surface as a real
   * error, never a shared-key fallback. 'trial_expired' (#1579) is a tmp_ key
   * past its real expiry window — detected here, before ever calling ZeroDB,
   * so the caller gets an honest, distinct reason instead of ZeroDB's own
   * opaque 401 AUTH_REQUIRED.
   */
  reason?: 'not_stored' | 'decrypt_failed' | 'unconfigured' | 'lookup_failed' | 'trial_expired'
}

/** Latest stored row for a projectId, or null. */
async function resolveStoredRow(projectId: string): Promise<StoredZerodbKeyRow | null> {
  if (!configured() || !projectId) return null
  try {
    const res = await fetch(`${rowsUrl()}?limit=1000`, {
      headers: headers(),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    const rows = Array.isArray(data) ? data : data?.data || data?.rows || []
    const matches: StoredZerodbKeyRow[] = (Array.isArray(rows) ? rows : [])
      .map((r: { row_data?: StoredZerodbKeyRow }) => r?.row_data ?? (r as unknown as StoredZerodbKeyRow))
      .filter(
        (rd: StoredZerodbKeyRow | undefined): rd is StoredZerodbKeyRow =>
          !!rd?.projectId && rd.projectId === projectId && !!rd.encryptedKey && !!rd.iv && !!rd.authTag,
      )
    if (!matches.length) return null
    matches.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    return matches[0]
  } catch {
    return null
  }
}

/**
 * Resolve the real, project-scoped data-plane key for a company's own ZeroDB
 * project. FAILS CLOSED: never returns the shared service key, never throws.
 *
 * Callers MUST treat {ok:false} as a hard error for the request (a 403/502
 * surfaced honestly) rather than retrying with the shared key — using a key
 * that isn't scoped to the target project is precisely the cross-tenant
 * mis-scoping bug this module fixes.
 *
 * TRIAL EXPIRY + AUTO-RENEWAL (#1579, corrected by #1602, renewal added
 * #1579-followup): a `tmp_` key minted for an anonymous/unpaid provision has
 * a REAL expiry core returns at mint time (`expires_at`) — confirmed live
 * (#1602) to be 24h, not the `TRIAL_WINDOW_MS` (72h) fallback this used to
 * check unconditionally. Prefers the row's real `expiresAt` when present;
 * falls back to `createdAt + TRIAL_WINDOW_MS` only for rows stored before
 * that field existed (or when core ever omits `expires_at`).
 *
 * On a confirmed expiry, this now ATTEMPTS A RENEWAL via
 * `mintProjectScopedKey` — minting a fresh key against the SAME existing
 * project_id, never re-provisioning (which would orphan the founder's real
 * data under an abandoned project). This only works because core confirmed
 * (core#9282, 2026-10-27) that Builder's admin/service identity resolves to
 * a real user who is a genuine member of the specific org anonymous
 * instant-db projects get attributed to — NOT a universal ownership bypass,
 * and NOT a contract core enforces or tests today. It depends on that
 * account's org membership staying as-is, which could change for reasons
 * entirely unrelated to this feature. So a renewal attempt is always
 * best-effort: a 404/failure here must fall through to the same honest
 * 'trial_expired' this already returned before renewal existed, never throw,
 * and never block the caller waiting on a result. A successful renewal
 * stores the fresh (permanent, `sk_`) key via `storeCompanyZerodbKey` and
 * returns it immediately — the very request that triggered renewal is
 * served too, not just the next one. Concurrent requests hitting the same
 * expired key at once may each mint their own fresh key (core allows
 * multiple keys per project); the append-only, latest-wins store makes that
 * harmless — deliberately not de-duped, since the alternative is in-memory
 * coordination state this module has otherwise never needed. A company
 * that's since been claimed/paid has its row's keyKind flipped to
 * 'permanent' by the claim flow (claimCompanyProject) before ever reaching
 * this check, so a real paid company is never affected by any of this.
 */
export async function resolveCompanyZerodbKey(projectId: string): Promise<ResolvedZerodbKey> {
  if (!projectId) return { ok: false, reason: 'not_stored' }
  if (!configured()) return { ok: false, reason: 'unconfigured' }
  let row: StoredZerodbKeyRow | null
  try {
    row = await resolveStoredRow(projectId)
  } catch {
    return { ok: false, reason: 'lookup_failed' }
  }
  if (!row) return { ok: false, reason: 'not_stored' }
  if (row.keyKind === 'tmp') {
    const realExpiry = row.expiresAt ? new Date(row.expiresAt).getTime() : NaN
    const expired = Number.isFinite(realExpiry)
      ? Date.now() > realExpiry
      : !!(row.createdAt && Date.now() - new Date(row.createdAt).getTime() > TRIAL_WINDOW_MS)
    if (expired) {
      const renewed = await renewExpiredKey(projectId, row.slug)
      if (renewed.ok) return renewed
      return { ok: false, reason: 'trial_expired' }
    }
  }
  try {
    const apiKey = decryptToken({ encryptedToken: row.encryptedKey, iv: row.iv, authTag: row.authTag })
    if (!apiKey) return { ok: false, reason: 'decrypt_failed' }
    return { ok: true, apiKey }
  } catch {
    return { ok: false, reason: 'decrypt_failed' }
  }
}

/**
 * Best-effort renewal for an expired `tmp_` key (#1579-followup). Mints a
 * fresh key against the EXISTING project via `mintProjectScopedKey` (never
 * re-provisioning), stores it, and returns it directly so the triggering
 * request is served immediately rather than waiting for a second round trip.
 * Never throws — a renewal failure (404, network error, scope_mismatch, …)
 * is swallowed here and reported as {ok:false}, letting the caller fall back
 * to the pre-existing honest 'trial_expired' behavior.
 */
async function renewExpiredKey(projectId: string, slug?: string): Promise<ResolvedZerodbKey> {
  try {
    const minted = await mintProjectScopedKey(projectId, { slug, name: `builder-auto-renew-1579-${slug || projectId}` })
    if (!minted.ok || !minted.apiKey) return { ok: false, reason: 'not_stored' }
    const stored = await storeCompanyZerodbKey(projectId, minted.apiKey, { slug, keyKind: 'permanent' }).catch(() => false)
    if (!stored) return { ok: false, reason: 'not_stored' }
    return { ok: true, apiKey: minted.apiKey }
  } catch {
    return { ok: false, reason: 'not_stored' }
  }
}

/** Whether a project-scoped key has ever been stored for this project. */
export async function hasCompanyZerodbKey(projectId: string): Promise<boolean> {
  return (await resolveStoredRow(projectId)) !== null
}

export interface MintedProjectKey {
  ok: boolean
  /** The full, one-time-visible data-plane key. Present only when ok. */
  apiKey?: string
  /** Honest failure detail — core's own `detail`, or a structural reason. */
  reason?: string
  /** Core's HTTP status, when the call actually reached core. */
  status?: number
  /**
   * Extra operator-facing context for a structural failure (currently only
   * `scope_mismatch`, where it names the requested vs. returned project_id).
   * Never carries the key itself.
   */
  detail?: string
}

/**
 * Mint a NEW data-plane key scoped to a company's ALREADY-EXISTING ZeroDB
 * project (#1013).
 *
 * WHY THIS IS NEEDED. `storeCompanyZerodbKey` above is written from exactly one
 * place — the provision path — with the key `provisionInstantDb` happened to
 * mint while CREATING the project. For a company provisioned before #806
 * shipped (2026-09-22), that key was returned once and discarded: it is
 * unrecoverable. The project itself still exists and still holds the founder's
 * real data, so re-provisioning (minting a brand-new project) would silently
 * orphan it. The only correct repair for those ~17 historical companies is to
 * mint a FRESH key against the EXISTING project id.
 *
 * Core exposes exactly that: `POST /api/v1/public/api-keys { name, project_id }`
 * → 201 APIKeyCreateResponse, whose `api_key` field carries the full key once
 * ("Save this key now - it won't be shown again!"). 404 means "Project not found
 * or access denied" — i.e. this identity cannot reach that project, which for a
 * backfill is a real terminal case (the project was deleted upstream, or was
 * never owned by Builder's identity), not a bug to retry around.
 *
 * IDENTITY — deliberately NOT the instant-db claim path. That path needs the
 * FOUNDER'S own bearer token (the claim associates a project to a specific real
 * account), and an offline repair sweep must never borrow a founder's identity
 * (CODY.md Rule 5). This uses Builder's OWN service key — the admin identity
 * that owns the Builder workspace every Instant DB project is filed under — and
 * fails honestly with core's own 404 when that identity genuinely cannot reach
 * the project.
 *
 * SCOPE IS VERIFIED AGAINST THE RESPONSE, NOT ASSUMED. `project_id` is OPTIONAL
 * and NULLABLE in BOTH `APIKeyCreateRequest` and `APIKeyCreateResponse` in
 * core's live openapi.json, so a 201 does NOT prove the key came back scoped to
 * the project we asked for: it can legitimately carry `project_id: null` (an
 * account-wide key) or a different project id. Accepting such a key here would
 * be strictly worse than leaving the company broken, because the #1013 sweep
 * then (a) writes it to the store, (b) reports `backfilled`, (c) sees it on the
 * next run and reports `already_stored` — so the company is never retried — and
 * (d) turns the company's honest, diagnosable 502 KEY_UNAVAILABLE into ZeroDB's
 * 403 API_KEY_PROJECT_MISMATCH, which is precisely the cross-tenant mis-scoping
 * #806 existed to eliminate. So the response's own `project_id` must match the
 * requested `projectId` exactly; anything else is `scope_mismatch`, and the key
 * is dropped here rather than being handed to `storeCompanyZerodbKey`.
 *
 * Never throws; returns {ok:false, reason} so a sweep can report it per-company
 * rather than aborting. A caller MUST NOT treat {ok:false} as anything but a
 * failure — there is no fallback key that would be correctly scoped.
 */
export async function mintProjectScopedKey(
  projectId: string,
  options: { slug?: string; name?: string } = {},
): Promise<MintedProjectKey> {
  if (!projectId) return { ok: false, reason: 'no_project_id' }
  const key = serviceKey()
  if (!key) return { ok: false, reason: 'unconfigured' }

  // A human-traceable name, so an operator looking at this key in core can see
  // which company it belongs to and that a #1013 backfill created it.
  const name = options.name || `builder-backfill-1013-${options.slug || projectId}`

  try {
    const res = await fetch(`${AINATIVE_API}/api/v1/public/api-keys`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'X-API-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, project_id: projectId }),
      signal: AbortSignal.timeout(30000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        reason: String(data?.detail || data?.error_code || res.status).slice(0, 200),
      }
    }
    const apiKey = typeof data?.api_key === 'string' ? data.api_key : ''
    // A 201 with no key in the body is a failure, not a success — storing an
    // empty key would make the company look repaired while still failing closed.
    if (!apiKey) return { ok: false, status: res.status, reason: 'no_api_key_in_response' }

    // A key whose scope we cannot PROVE is the project we asked for must not
    // escape this function — see the SCOPE IS VERIFIED note above for why a
    // mis-scoped key is worse than no key at all. Note the deliberate ordering:
    // this runs before the key is returned, so it can never reach the store.
    const grantedProjectId = typeof data?.project_id === 'string' ? data.project_id : ''
    if (grantedProjectId !== projectId) {
      return {
        ok: false,
        status: res.status,
        reason: 'scope_mismatch',
        // The requested/granted pair, for an operator reading the sweep output.
        // The key itself is deliberately NOT returned.
        detail: `requested project_id=${projectId} but core returned project_id=${
          data?.project_id === null
            ? 'null'
            : data?.project_id === undefined
              ? '(absent)'
              : String(data.project_id).slice(0, 80)
        }`,
      }
    }

    return { ok: true, apiKey, status: res.status }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}
