/**
 * Waitlist metrics (#844) — real signups behind the Live dashboard's
 * "waitlist" hero metric, and the data behind a founder-facing waitlist list.
 *
 * Real gap fix: the hero metric was a permanent, hardcoded 0 — "Live from day
 * one — Cody grows these nightly" copy with nothing ever growing it — even
 * though the hero waitlist form (primitive-catalog.ts's EMAIL / WAITLIST
 * CAPTURE block) already correctly persists every real signup via
 * `POST /api/db/waitlist`. The write side works; nothing ever read it back.
 * Mirrors visitor-metrics.ts's KEY SCOPING fix (#806) verbatim — a
 * company's own ZeroDB project needs that project's OWN stored key, never
 * the shared service key.
 */

import { getAinativeApiKey } from '@/lib/build/env-keys'
import { resolveCompanyZerodbKey } from '@/lib/build/company-zerodb-credentials'

const ZERODB_API = process.env.ZERODB_API_URL || 'https://api.ainative.studio/api'
const SHARED_PROJECT_ID = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'

function getApiKey(): string {
  return getAinativeApiKey()
}

export interface WaitlistEntry {
  email: string
  joinedAt: string
}

async function queryWaitlistRows(
  projectId: string,
  apiKey: string,
): Promise<any[] | null> {
  try {
    const res = await fetch(
      `${ZERODB_API}/v1/projects/${projectId}/database/tables/waitlist/query`,
      {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: {}, limit: 500 }),
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    const rows = Array.isArray(data) ? data : data?.data || data?.rows || []
    return Array.isArray(rows) ? rows : null
  } catch {
    return null
  }
}

/**
 * Real waitlist entries for a company, newest first. Returns [] (never
 * fabricated) for a never-provisioned app or any read failure — an honest
 * empty state, exactly like visitor-metrics.ts's countVisitors().
 *
 * Only the per-project path applies here (unlike visitor-metrics.ts's shared-
 * project fallback): the shared project has no per-company column and a
 * waitlist row carries no chatId/path to scope by, so a company with no
 * dedicated ZeroDB project genuinely has no addressable waitlist table yet.
 */
export async function listWaitlist(
  projectId: string | undefined | null,
): Promise<WaitlistEntry[]> {
  if (!projectId) return []

  let apiKey: string | undefined
  if (projectId === SHARED_PROJECT_ID) {
    apiKey = getApiKey()
  } else {
    const key = await resolveCompanyZerodbKey(projectId).catch(() => ({ ok: false } as const))
    if (!key.ok || !key.apiKey) return []
    apiKey = key.apiKey
  }

  const rows = await queryWaitlistRows(projectId, apiKey)
  if (!rows) return []

  return rows
    .map((r) => r?.row_data || r)
    .filter((rd): rd is WaitlistEntry => typeof rd?.email === 'string' && rd.email.length > 0)
    .sort((a, b) => String(b.joinedAt || '').localeCompare(String(a.joinedAt || '')))
}

/** Count of real waitlist signups — the hero-metric number. */
export async function countWaitlist(projectId: string | undefined | null): Promise<number> {
  return (await listWaitlist(projectId)).length
}
