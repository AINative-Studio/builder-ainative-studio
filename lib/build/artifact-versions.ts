/**
 * Artifact content version history (#BLD-06.4) -- genuinely new: no
 * version/restore mechanism exists for artifact CONTENT anywhere in this
 * codebase (document-store.ts's upsertDocument is overwrite-only;
 * version-store.ts is Railway deploy history, a different domain).
 * Mirrors the ensureTable-then-write idempotent-create pattern already
 * established in otp.ts/funnel-events.ts.
 */
import { getAinativeApiKey } from '@/lib/build/env-keys'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = getAinativeApiKey()
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const VERSIONS_TABLE = 'builder_artifact_versions'

export interface ArtifactVersion {
  id: string
  companyId: string
  view: string
  content: unknown
  savedAt: string
  label?: string
}

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}
function configured(): boolean {
  return Boolean(API_KEY && PROJECT_ID)
}

async function ensureVersionsTable(): Promise<void> {
  try {
    await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ table_name: VERSIONS_TABLE }),
      signal: AbortSignal.timeout(5000),
    })
  } catch { /* table might already exist */ }
}

function makeId(): string {
  return `v_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export async function saveArtifactVersion(
  companyId: string, view: string, content: unknown, label?: string,
): Promise<{ ok: boolean }> {
  if (!configured()) return { ok: false }
  await ensureVersionsTable()
  const id = makeId()
  try {
    const res = await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${VERSIONS_TABLE}/rows`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ row_data: { id, companyId, view, content, savedAt: new Date().toISOString(), label } }),
      signal: AbortSignal.timeout(15000),
    })
    return { ok: res.ok }
  } catch {
    return { ok: false }
  }
}

export async function listArtifactVersions(companyId: string, view: string): Promise<ArtifactVersion[]> {
  if (!configured()) return []
  try {
    const res = await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${VERSIONS_TABLE}/rows?limit=1000`, {
      headers: headers(), signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []
    const data = JSON.parse(await res.text())
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    const matches = rows
      .map((r: { row_data?: ArtifactVersion }) => r.row_data)
      .filter((rd: ArtifactVersion | undefined): rd is ArtifactVersion => Boolean(rd && rd.companyId === companyId && rd.view === view))
    matches.sort((a: ArtifactVersion, b: ArtifactVersion) => (b.savedAt || '').localeCompare(a.savedAt || ''))
    return matches
  } catch {
    return []
  }
}

export async function restoreArtifactVersion(
  companyId: string, view: string, versionId: string,
): Promise<{ ok: boolean; content?: unknown }> {
  const versions = await listArtifactVersions(companyId, view)
  const match = versions.find((v) => v.id === versionId)
  if (!match) return { ok: false }
  return { ok: true, content: match.content }
}
