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
 * AES-256-GCM encryptToken/decryptToken from lib/services/credentials.service,
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

import { encryptToken, decryptToken } from '@/lib/services/credentials.service'
import { getAinativeApiKey } from '@/lib/build/env-keys'

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
  /** 'permanent' (sk_) or 'tmp' (72h trial) — mirrors InstantDbResult.keyKind. */
  keyKind?: 'tmp' | 'permanent'
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
  options: { slug?: string; keyKind?: 'tmp' | 'permanent' } = {},
): Promise<boolean> {
  if (!configured() || !projectId || !apiKey) return false
  try {
    await ensureTable()
    const enc = encryptToken(apiKey)
    const row: StoredZerodbKeyRow = {
      projectId,
      ...(options.slug ? { slug: options.slug } : {}),
      ...(options.keyKind ? { keyKind: options.keyKind } : {}),
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
   * error, never a shared-key fallback.
   */
  reason?: 'not_stored' | 'decrypt_failed' | 'unconfigured' | 'lookup_failed'
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
  try {
    const apiKey = decryptToken({ encryptedToken: row.encryptedKey, iv: row.iv, authTag: row.authTag })
    if (!apiKey) return { ok: false, reason: 'decrypt_failed' }
    return { ok: true, apiKey }
  } catch {
    return { ok: false, reason: 'decrypt_failed' }
  }
}

/** Whether a project-scoped key has ever been stored for this project. */
export async function hasCompanyZerodbKey(projectId: string): Promise<boolean> {
  return (await resolveStoredRow(projectId)) !== null
}
