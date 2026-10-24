/**
 * Anonymous draft autosave + resume (#E3.4) — extends pending-build.ts's
 * real, already-shipped localStorage mechanism (same-browser only, no TTL)
 * with genuine server-side ZeroDB persistence keyed by a random
 * browser-scoped token (never PII, never logged). Mirrors the
 * ensureTable-then-write idempotent-create pattern already established in
 * otp.ts/funnel-events.ts/artifact-versions.ts.
 */
import { getAinativeApiKey } from '@/lib/build/env-keys'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = getAinativeApiKey()
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const DRAFTS_TABLE = 'builder_anon_drafts'

export interface AnonDraft {
  idea: string
  track: 'app' | 'company'
  answers: Record<string, string>
  step: string
}

interface AnonDraftRow extends AnonDraft {
  token: string
  updatedAt: string
}

interface RawRow {
  row_id?: string
  row_data?: AnonDraftRow
}

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}
function configured(): boolean {
  return Boolean(API_KEY && PROJECT_ID)
}

async function ensureDraftsTable(): Promise<void> {
  try {
    await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ table_name: DRAFTS_TABLE }),
      signal: AbortSignal.timeout(5000),
    })
  } catch { /* table might already exist */ }
}

/** Raw rows (row_id + row_data), for callers that need the id to delete by. */
async function allRawRows(): Promise<Array<{ rowId: string; data: AnonDraftRow }>> {
  try {
    const res = await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${DRAFTS_TABLE}/rows?limit=5000`, {
      headers: headers(), signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []
    const data = JSON.parse(await res.text())
    const rows: RawRow[] = Array.isArray(data) ? data : data.data || data.rows || []
    return rows
      .filter((r): r is RawRow & { row_id: string; row_data: AnonDraftRow } => Boolean(r.row_id && r.row_data))
      .map((r) => ({ rowId: r.row_id, data: r.row_data }))
  } catch {
    return []
  }
}

async function allRows(): Promise<AnonDraftRow[]> {
  return (await allRawRows()).map((r) => r.data)
}

/** Save the draft for a token. Append-only, same as every other ZeroDB
 * table in this codebase (otp.ts, funnel-events.ts) -- there is no real
 * update-by-key. loadAnonDraft always resolves the newest row for a
 * token, so a later save correctly supersedes an earlier one on read even
 * though both remain stored. */
export async function saveAnonDraft(token: string, draft: AnonDraft): Promise<{ ok: boolean }> {
  if (!configured() || !token) return { ok: false }
  await ensureDraftsTable()
  try {
    const res = await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${DRAFTS_TABLE}/rows`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ row_data: { token, ...draft, updatedAt: new Date().toISOString() } }),
      signal: AbortSignal.timeout(15000),
    })
    return { ok: res.ok }
  } catch {
    return { ok: false }
  }
}

export async function loadAnonDraft(token: string): Promise<AnonDraft | null> {
  if (!configured() || !token) return null
  const rows = await allRows()
  const match = rows.filter((r) => r.token === token).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0]
  if (!match) return null
  return { idea: match.idea, track: match.track, answers: match.answers, step: match.step }
}

/** Delete every stored row for a token (there may be more than one, since
 * saveAnonDraft is append-only) — same per-row DELETE the purge cron uses.
 * Best-effort: a caller that just finished attaching the draft to a real
 * account should never fail its own request because this cleanup didn't
 * land; a missed delete just means the row sits until the 30-day purge. */
export async function deleteAnonDraft(token: string): Promise<{ ok: boolean; deleted: number }> {
  if (!configured() || !token) return { ok: false, deleted: 0 }
  const raw = await allRawRows()
  const matches = raw.filter((r) => r.data.token === token)
  let deleted = 0
  for (const row of matches) {
    try {
      const res = await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${DRAFTS_TABLE}/rows/${row.rowId}`, {
        method: 'DELETE', headers: headers(), signal: AbortSignal.timeout(15000),
      })
      if (res.ok) deleted++
    } catch { /* best-effort — a missed delete just means it's purged in 30 days */ }
  }
  return { ok: deleted === matches.length, deleted }
}
