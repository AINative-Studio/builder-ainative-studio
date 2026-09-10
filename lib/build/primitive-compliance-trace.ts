/**
 * Durable tracing for the primitive-compliance retry loop (issue #624 follow-up,
 * 2026-09-10) — chat-ws's closePrimitiveComplianceGap() needs verifiable proof
 * of whether it ran, and what it did, for a real generation. Live verification
 * repeatedly hit a wall trying to confirm this via `railway logs`: the CLI
 * exposes only a small, apparently-stale rolling buffer that never showed the
 * retry's own log line for a real Meridian generation, even after the retry
 * was confirmed correct by source inspection and passing unit tests. Racing an
 * unreliable log tail is not a real verification method.
 *
 * This appends one durable row per attempt to ZeroDB (mirrors lib/build/
 * learning.ts's exact row-append pattern), so a real verification can just
 * query the record for a chatId instead of grepping logs. Best-effort: never
 * throws into the generation request path.
 */

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY || ''
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const TABLE = 'builder_primitive_compliance_trace'

function rowsUrl(): string {
  return `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${TABLE}/rows`
}
function queryUrl(): string {
  return `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${TABLE}/query`
}
function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}
function configured(): boolean {
  return Boolean(API_KEY && PROJECT_ID)
}

export interface PrimitiveComplianceTraceRow {
  chatId: string
  /** Which adoption branch invoked the retry — helps distinguish the
   *  single-file vs multi-file code paths during live verification. */
  branch: 'non-combined' | 'combined-single-file' | 'combined-multi-file' | 'combined-rejected-fallback'
  isMultiFile: boolean
  attemptsRun: number
  gapsBefore: string[]
  gapsAfter: string[]
  closed: boolean
  createdAt: string
}

/**
 * Append one durable trace row. Best-effort — resolves false on any failure
 * and NEVER throws (safe to fire-and-forget in the generation request path).
 */
export async function traceComplianceRetry(
  row: Omit<PrimitiveComplianceTraceRow, 'createdAt'>,
): Promise<boolean> {
  if (!configured() || !row.chatId) return false
  try {
    const res = await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        row_data: {
          chatId: String(row.chatId).slice(0, 64),
          branch: row.branch,
          isMultiFile: row.isMultiFile,
          attemptsRun: row.attemptsRun,
          gapsBefore: row.gapsBefore,
          gapsAfter: row.gapsAfter,
          closed: row.closed,
          createdAt: new Date().toISOString(),
        },
      }),
      signal: AbortSignal.timeout(15000),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Read every trace row for a chatId, newest first. Returns [] when
 * unconfigured/failed/not found — the real verification tool for this
 * mechanism, used in place of grepping railway logs.
 */
export async function readComplianceTrace(chatId: string): Promise<PrimitiveComplianceTraceRow[]> {
  if (!configured() || !chatId) return []
  try {
    const res = await fetch(queryUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ filters: { chatId }, limit: 20 }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []
    const data = await res.json().catch(() => null)
    const rows = data?.data || []
    return rows
      .map((r: { row_data?: PrimitiveComplianceTraceRow }) => r.row_data)
      .filter((r: PrimitiveComplianceTraceRow | undefined): r is PrimitiveComplianceTraceRow => !!r)
      .sort((a: PrimitiveComplianceTraceRow, b: PrimitiveComplianceTraceRow) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}
