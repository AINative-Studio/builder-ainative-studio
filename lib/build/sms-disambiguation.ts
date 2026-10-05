/**
 * Short-lived, ZeroDB-backed pending-disambiguation state for the shared
 * Text-Cody number (#936). A founder with 2+ companies gets a numbered list
 * and must reply with a number — but the question and the reply arrive as
 * two SEPARATE, stateless webhook calls. In-memory state (the pattern
 * lib/build/otp.ts's rate-limiter uses) is confirmed unsuitable here: a
 * serverless/edge deployment can route the two calls to different
 * instances, losing in-memory state between them. This follows the exact
 * append-only ZeroDB pattern lib/build/founder-phones.ts already uses.
 */

import { getAinativeApiKey } from '@/lib/build/env-keys'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = getAinativeApiKey()
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const TABLE = 'builder_sms_disambiguation'
const TTL_MS = 10 * 60 * 1000 // 10 minutes

function rowsUrl(): string {
  return `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${TABLE}/rows`
}
function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}
function configured(): boolean {
  return Boolean(API_KEY && PROJECT_ID)
}

export interface PendingCompany {
  slug: string
  name: string
}

interface DisambiguationRow {
  fromNumber: string
  companies: PendingCompany[]
  expiresAt: string
  createdAt: string
}

/** Record a pending disambiguation question for this phone number. Best-effort. */
export async function setPendingDisambiguation(fromNumber: string, companies: PendingCompany[]): Promise<boolean> {
  if (!configured() || !fromNumber || companies.length === 0) return false
  try {
    const now = new Date()
    const res = await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        row_data: {
          fromNumber,
          companies,
          expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
          createdAt: now.toISOString(),
        } satisfies DisambiguationRow,
      }),
      signal: AbortSignal.timeout(15000),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Read the pending companies list for this phone number, or null if none
 * exists or it has expired. Expiry is checked here, not left to the caller —
 * an expired entry must never be silently treated as still valid.
 */
export async function getPendingDisambiguation(fromNumber: string): Promise<PendingCompany[] | null> {
  if (!configured() || !fromNumber) return null
  try {
    const res = await fetch(`${rowsUrl()}?limit=1000`, { headers: headers(), signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const data = JSON.parse(await res.text())
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    const entries: DisambiguationRow[] = rows
      .map((r: { row_data?: DisambiguationRow }) => r.row_data)
      .filter((rd: DisambiguationRow | undefined): rd is DisambiguationRow => !!rd && rd.fromNumber === fromNumber)
    if (entries.length === 0) return null
    entries.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    const latest = entries[0]
    if (new Date(latest.expiresAt).getTime() <= Date.now()) return null
    return latest.companies
  } catch {
    return null
  }
}

/** Append a cleared/already-expired marker so a resolved disambiguation
 *  doesn't get re-read as still-pending by a later getPendingDisambiguation
 *  call (append-only store — this writes a new row with expiresAt in the
 *  past, which getPendingDisambiguation's own expiry check already treats
 *  as invalid, rather than requiring a separate "is this cleared" flag). */
export async function clearPendingDisambiguation(fromNumber: string): Promise<boolean> {
  if (!configured() || !fromNumber) return false
  try {
    const now = new Date()
    const res = await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        row_data: {
          fromNumber,
          companies: [],
          expiresAt: new Date(now.getTime() - 1000).toISOString(),
          createdAt: now.toISOString(),
        } satisfies DisambiguationRow,
      }),
      signal: AbortSignal.timeout(15000),
    })
    return res.ok
  } catch {
    return false
  }
}
