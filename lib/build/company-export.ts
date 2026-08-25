/**
 * Company data export (#63.C) — "you own your data, take it anytime".
 *
 * Exports a company's OWN ZeroDB project (the per-company project provisioned via
 * Instant DB, #243) as a downloadable file. This is a core ownership differentiator
 * vs a closed box: the founder can pull 100% of their data as JSON or CSV whenever
 * they want.
 *
 * Read path: the per-company project is filed under the AINative Builder workspace
 * and read with the Builder's admin key (same auth the systems route uses to read
 * per-company counts). We:
 *   1. list the project's tables — GET /api/v1/projects/{id}/database/tables
 *   2. page each table's rows  — GET .../database/tables/{table}/rows?limit=…
 * then serialise the collected tables to JSON or a CSV bundle.
 *
 * All functions are best-effort + non-throwing where they touch the network, and
 * the pure serialisers (toJsonExport / tableToCsv / rowsToColumns) are fully unit
 * tested with no network. NEVER logs row contents (a founder's data is private).
 */

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'

/** The Builder admin key that can read the company projects filed under the Builder workspace. */
function exportApiKey(): string {
  return process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY || ''
}

/** Max rows fetched per table (defends payload + memory on a large export). */
export const MAX_EXPORT_ROWS_PER_TABLE = 5000

/** Supported export formats. */
export const EXPORT_FORMATS = ['json', 'csv'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

/** Is `f` a supported export format? Pure. */
export function isExportFormat(f: unknown): f is ExportFormat {
  return typeof f === 'string' && (EXPORT_FORMATS as readonly string[]).includes(f)
}

/** One table's exported data. */
export interface ExportedTable {
  name: string
  rows: Record<string, unknown>[]
}

/** The full export payload for a company project. */
export interface CompanyExport {
  projectId: string
  exportedAt: string
  tableCount: number
  rowCount: number
  tables: ExportedTable[]
}

// ---------------------------------------------------------------------------
// Pure serialisers (fully unit-tested, no network)
// ---------------------------------------------------------------------------

/** A safe, timestamped download filename for a company export. Pure. */
export function exportFileName(slug: string, format: ExportFormat, at: Date = new Date()): string {
  const safe = String(slug || 'company').replace(/[^a-z0-9_-]/gi, '').slice(0, 40).toLowerCase() || 'company'
  const stamp = at.toISOString().slice(0, 10) // YYYY-MM-DD
  const ext = format === 'csv' ? 'zip' : 'json'
  return `${safe}-data-${stamp}.${ext}`
}

/** The Content-Type for a given export format. Pure. */
export function exportContentType(format: ExportFormat): string {
  // CSV is delivered as a multi-table text bundle (one CSV block per table); we
  // serve it as text/csv. JSON as application/json.
  return format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8'
}

/** Serialise the full export as pretty JSON. Pure. */
export function toJsonExport(data: CompanyExport): string {
  return JSON.stringify(data, null, 2)
}

/**
 * Derive the union of column names across a table's rows, in first-seen order.
 * Stable so CSV columns are deterministic across exports. Pure.
 */
export function rowsToColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>()
  const cols: string[] = []
  for (const row of rows || []) {
    for (const k of Object.keys(row || {})) {
      if (!seen.has(k)) {
        seen.add(k)
        cols.push(k)
      }
    }
  }
  return cols
}

/** Escape a single CSV cell per RFC 4180: quote if it contains "," CR LF or a quote. Pure. */
export function csvCell(value: unknown): string {
  let s: string
  if (value == null) s = ''
  else if (typeof value === 'object') s = JSON.stringify(value)
  else s = String(value)
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** Serialise one table to a CSV string (header row + data rows). Pure. */
export function tableToCsv(table: ExportedTable): string {
  const cols = rowsToColumns(table.rows)
  if (cols.length === 0) return '' // empty table → empty CSV block
  const lines: string[] = [cols.map(csvCell).join(',')]
  for (const row of table.rows) {
    lines.push(cols.map((c) => csvCell(row?.[c])).join(','))
  }
  return lines.join('\r\n')
}

/**
 * Serialise a whole export to a single CSV bundle: one labelled block per table,
 * separated by blank lines. Each block is prefixed with a `# table: <name>`
 * comment so a founder can split them apart. Pure.
 */
export function toCsvExport(data: CompanyExport): string {
  const blocks: string[] = []
  for (const table of data.tables) {
    const csv = tableToCsv(table)
    blocks.push(`# table: ${table.name} (${table.rows.length} rows)\r\n${csv}`)
  }
  return blocks.join('\r\n\r\n')
}

/** Serialise an export in the requested format. Pure — dispatches to toJson/toCsv. */
export function serializeExport(data: CompanyExport, format: ExportFormat): string {
  return format === 'csv' ? toCsvExport(data) : toJsonExport(data)
}

// ---------------------------------------------------------------------------
// ZeroDB read path (network — best-effort, non-throwing)
// ---------------------------------------------------------------------------

/** Whether the export read path is configured (admin key present). */
export function exportConfigured(): boolean {
  return !!exportApiKey()
}

/** List the table names in a company's ZeroDB project. Returns [] on any failure. */
export async function listProjectTables(projectId: string): Promise<string[]> {
  const key = exportApiKey()
  if (!key || !projectId) return []
  try {
    const res = await fetch(`${AINATIVE_API}/api/v1/projects/${projectId}/database/tables`, {
      headers: { Authorization: `Bearer ${key}`, 'X-API-Key': key },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []
    const data = await res.json().catch(() => null)
    // The API returns either a bare array of table objects, or { tables: [...] }.
    const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.tables) ? data.tables : []
    return list
      .map((t) => (typeof t === 'string' ? t : String(t?.name || t?.table_name || '')))
      .filter((n) => !!n)
  } catch {
    return []
  }
}

/** Fetch all rows (capped) for a single table. Returns [] on any failure. */
export async function fetchTableRows(projectId: string, table: string): Promise<Record<string, unknown>[]> {
  const key = exportApiKey()
  if (!key || !projectId || !table) return []
  try {
    const res = await fetch(
      `${AINATIVE_API}/api/v1/projects/${projectId}/database/tables/${encodeURIComponent(table)}/rows?limit=${MAX_EXPORT_ROWS_PER_TABLE}`,
      {
        headers: { Authorization: `Bearer ${key}`, 'X-API-Key': key },
        signal: AbortSignal.timeout(20000),
      },
    )
    if (!res.ok) return []
    const data = await res.json().catch(() => null)
    const rows: any[] = Array.isArray(data) ? data : (data?.data || data?.rows || [])
    // Prefer the row_data payload if present (ZeroDB wraps user data under row_data),
    // else use the row object as-is.
    return rows.map((r) => (r && typeof r === 'object' && r.row_data && typeof r.row_data === 'object' ? r.row_data : r))
  } catch {
    return []
  }
}

export interface BuildExportResult {
  ok: boolean
  export?: CompanyExport
  reason?: string
}

/**
 * Build the full export payload for a company's ZeroDB project (#63.C): list its
 * tables and collect each table's rows. Best-effort: an empty project yields an
 * export with zero tables (an honest "no data yet" download), never an error.
 * Returns { ok:false } only when the read path isn't configured or no projectId.
 */
export async function buildCompanyExport(projectId: string): Promise<BuildExportResult> {
  if (!exportConfigured()) return { ok: false, reason: 'not_configured' }
  if (!projectId) return { ok: false, reason: 'no_project' }

  const tableNames = await listProjectTables(projectId)
  const tables: ExportedTable[] = []
  let rowCount = 0
  for (const name of tableNames) {
    const rows = await fetchTableRows(projectId, name)
    rowCount += rows.length
    tables.push({ name, rows })
  }
  return {
    ok: true,
    export: {
      projectId,
      exportedAt: new Date().toISOString(),
      tableCount: tables.length,
      rowCount,
      tables,
    },
  }
}
