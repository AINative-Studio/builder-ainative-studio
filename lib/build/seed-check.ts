/**
 * Seeded-data check (#343) — the READY-PATH half of "MCP-provisioned real data
 * in every data-backed build".
 *
 * The agent prompt (lib/agent/claude-agent.ts + mcpDataProvisioningBlock) now
 * instructs Cody to create real ZeroDB tables and seed 5-10 realistic records
 * for any data-backed app. This module verifies that actually happened at the
 * "mark ready" seam (register-app): extract the /api/db/{table} tables the
 * generated code touches, then do a CHEAP ZeroDB read (limit=1 per table, in
 * parallel, tight timeout) to confirm at least one real table exists with at
 * least one row.
 *
 * FAIL-OPEN by design: this check NEVER blocks registration. An unseeded app
 * still works (it starts empty and fills as the user adds records), and a
 * ZeroDB hiccup must never take down the ready path. The result is surfaced to
 * the caller (response field + warn log) so we can measure real-data adoption,
 * not used as a gate.
 */

export interface SeededDataCheck {
  /** True when we actually reached ZeroDB and got definitive answers. */
  checked: boolean
  /** True when the generated code reads/writes through /api/db/{table}. */
  dataBacked: boolean
  /** Table names referenced by the code (deduped, capped). */
  tables: string[]
  /** Referenced tables that exist AND have at least one row. */
  seededTables: string[]
  /** True when at least one referenced table is seeded. Only meaningful when
   *  checked && dataBacked. */
  seeded: boolean
  detail: string
}

const ZERODB_API = 'https://api.ainative.studio/api'
const SHARED_PROJECT_ID = '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'

/** Max tables to probe — keeps the ready path cheap. */
const MAX_TABLES = 3
/** Per-read timeout. Reads run in parallel so this bounds the whole check. */
const READ_TIMEOUT_MS = 4000

/**
 * Extract the /api/db/{table} table names a generated app references.
 * Matches plain string literals AND template literals ("/api/db/tasks",
 * `/api/db/notes?id=${id}`). A fully dynamic segment (`/api/db/${table}`)
 * doesn't match — we can't know the name statically, and that's fine
 * (fail-open). Pure + deterministic for unit tests.
 */
export function extractDbTables(code: string): string[] {
  const out: string[] = []
  const re = /\/api\/db\/([A-Za-z0-9_-]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code || '')) !== null) {
    const table = m[1]
    if (!out.includes(table)) out.push(table)
  }
  return out
}

/** One cheap row read. Returns true/false when definitive, null when unknown
 *  (network/timeout/5xx — fail-open). */
async function tableHasRows(
  projectId: string,
  table: string,
  apiKey: string,
): Promise<boolean | null> {
  try {
    const res = await fetch(
      `${ZERODB_API}/v1/projects/${projectId}/database/tables/${encodeURIComponent(table)}/rows?limit=1`,
      {
        headers: { 'X-API-Key': apiKey },
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      },
    )
    if (res.status === 404) return false // table doesn't exist → definitively unseeded
    if (!res.ok) return null // auth/5xx/etc — can't verify
    const json: any = await res.json().catch(() => null)
    if (!json) return null
    const rows = Array.isArray(json.data) ? json.data : Array.isArray(json.rows) ? json.rows : null
    if (rows === null) return null
    return rows.length > 0
  } catch {
    return null // timeout / network — fail-open
  }
}

/**
 * Check whether a data-backed app's tables are actually provisioned + seeded.
 *
 * @param code      the generated app code (single-file or flattened)
 * @param projectId the company's own ZeroDB project when provisioned
 *                  (registry entry `zerodbProjectId`), else the shared preview
 *                  project — matching exactly where /api/db reads from.
 */
export async function checkSeededData(
  code: string,
  projectId?: string | null,
): Promise<SeededDataCheck> {
  const allTables = extractDbTables(code)
  const tables = allTables.slice(0, MAX_TABLES)
  const base: SeededDataCheck = {
    checked: false,
    dataBacked: allTables.length > 0,
    tables: allTables,
    seededTables: [],
    seeded: false,
    detail: '',
  }
  if (allTables.length === 0) {
    return { ...base, checked: true, detail: 'not data-backed (no /api/db references)' }
  }
  const apiKey = process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || ''
  if (!apiKey) {
    return { ...base, detail: 'no ZeroDB key — cannot verify (fail-open)' }
  }
  const pid = projectId || process.env.ZERODB_PROJECT_ID || SHARED_PROJECT_ID

  const results = await Promise.all(tables.map((t) => tableHasRows(pid, t, apiKey)))
  const seededTables = tables.filter((_, i) => results[i] === true)
  const anyUnknown = results.some((r) => r === null)
  const seeded = seededTables.length > 0
  return {
    ...base,
    // Only claim "checked" when every probe answered definitively OR we found
    // seeded data (a positive is definitive even if a sibling probe timed out).
    checked: seeded || !anyUnknown,
    seededTables,
    seeded,
    detail: seeded
      ? `seeded: ${seededTables.join(', ')}`
      : anyUnknown
        ? 'could not verify (ZeroDB read failed — fail-open)'
        : `data-backed but NO seeded rows in: ${tables.join(', ')}`,
  }
}
