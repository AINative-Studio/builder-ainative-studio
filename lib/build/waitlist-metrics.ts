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
 *
 * SHARED-PROJECT SCOPING (overnight founder-dashboard-integrity sweep,
 * same root cause as visitor-metrics.ts's #806/#1055 fix, just never applied
 * here): this module originally returned [] outright whenever `projectId` was
 * absent, on the documented reasoning that "the shared project has no
 * per-company column and a waitlist row carries no chatId/path to scope by."
 * That was true of the row shape at the time, but visitor-metrics.ts solved
 * the identical problem for pageviews by having the write side stamp
 * `path: window.location.pathname` on every row and scoping the shared-
 * project read by matching the company's own chatId inside that path.
 * primitive-catalog.ts's WAITLIST CAPTURE block now stamps the same `path`
 * field on every signup for the same reason — an unprovisioned company (no
 * dedicated ZeroDB project — confirmed live to be the common case, see
 * visitor-metrics.ts's own module doc) was persisting every real signup into
 * the shared table and then NEVER being able to read a single one back:
 * `listWaitlist(undefined)` returned [] immediately, before ever looking in
 * the shared project where those rows actually landed. Mirrors
 * visitor-metrics.ts's `listVisitors()` fallback shape exactly.
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

function toEntries(rows: any[] | null): WaitlistEntry[] {
  if (!rows) return []
  return rows
    .map((r) => r?.row_data || r)
    .filter((rd): rd is WaitlistEntry => typeof rd?.email === 'string' && rd.email.length > 0)
    .sort((a, b) => String(b.joinedAt || '').localeCompare(String(a.joinedAt || '')))
}

/**
 * Real waitlist entries for a company, newest first. Returns [] (never
 * fabricated) for a never-provisioned app or any read failure — an honest
 * empty state, exactly like visitor-metrics.ts's listVisitors().
 *
 * `projectId` — the company's OWN ZeroDB project, when provisioned (reads
 * every row there directly, no scoping needed — the table itself is already
 * private to that company). `chatId` — required to correctly scope entries in
 * the SHARED project (used when `projectId` is absent): matches only rows
 * whose recorded `path` contains this exact chatId, mirroring
 * visitor-metrics.ts's `listVisitors()` exactly, so one company's signups
 * never include another unprovisioned company's.
 */
export async function listWaitlist(
  projectId: string | undefined | null,
  chatId?: string | undefined | null,
): Promise<WaitlistEntry[]> {
  if (projectId && projectId !== SHARED_PROJECT_ID) {
    const key = await resolveCompanyZerodbKey(projectId).catch(() => ({ ok: false } as const))
    if (!key.ok || !key.apiKey) return []
    const rows = await queryWaitlistRows(projectId, key.apiKey)
    return toEntries(rows)
  }
  if (projectId) {
    // The company's project IS the shared project — the shared key is the
    // correctly-scoped key for it.
    const rows = await queryWaitlistRows(projectId, getApiKey())
    return toEntries(rows)
  }
  if (!chatId) return []
  const rows = await queryWaitlistRows(SHARED_PROJECT_ID, getApiKey())
  if (!rows) return []
  const matching = rows.filter((r) => {
    const path = String(r?.row_data?.path || r?.path || '')
    return path.includes(chatId)
  })
  return toEntries(matching)
}

/** Count of real waitlist signups — the hero-metric number. Delegates to
 *  listWaitlist() so the count and the founder-facing list (WaitlistPanel)
 *  can never drift apart, mirroring visitor-metrics.ts's countVisitors(). */
export async function countWaitlist(
  projectId: string | undefined | null,
  chatId?: string | undefined | null,
): Promise<number> {
  return (await listWaitlist(projectId, chatId)).length
}
