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

async function allRows(): Promise<AnonDraftRow[]> {
  try {
    const res = await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${DRAFTS_TABLE}/rows?limit=5000`, {
      headers: headers(), signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []
    const data = JSON.parse(await res.text())
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    return rows.map((r: { row_data?: AnonDraftRow }) => r.row_data).filter((rd: AnonDraftRow | undefined): rd is AnonDraftRow => Boolean(rd))
  } catch {
    return []
  }
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
