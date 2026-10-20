/**
 * Visitor metrics (#483/#563) — the real count behind the Live dashboard's
 * "visitors" hero metric.
 *
 * Real gap fix: the dashboard showed a permanent, hardcoded 0 with the copy
 * "Live from day one — Cody grows these nightly," but nothing anywhere ever
 * grew it — no generated app fired a pageview, and no route ever read one
 * back. The write side is the mandated `/api/db/visitors` beacon every
 * generated landing page now fires on mount (see primitive-catalog.ts's
 * FOUNDATION block + obedience-gate.ts's `hasVisitorTrackingGap`).
 *
 * Real, live bug found post-deploy (2026-09-06): every company sampled in
 * production had NO `zerodbProjectId` at all (none of the 11 real admin-owned
 * companies were provisioned with a dedicated ZeroDB project — they're all
 * pre-paid trial/guest builds). `/api/db/{table}` itself already handles this
 * by falling back to a SHARED_PROJECT_ID for any unprovisioned app (see
 * app/api/db/[table]/route.ts's `resolveProject`) — but this module only ever
 * checked the per-app project, which is `undefined` for these apps, so it
 * never even looked in the shared project where the real beacon rows
 * actually landed. Confirmed live: real rows exist in the shared project's
 * `visitors` table (e.g. a real row from this session's own fresh-generation
 * test), while every company's dashboard read a permanent 0.
 *
 * The shared table has no per-company column — a generated app has no way to
 * know its own registered slug at runtime, so the beacon can only record
 * `path: window.location.pathname`, which is the PREVIEW route
 * (`/api/preview/{chatId}`), not the slug. chatId IS 1:1 with a company
 * (app-registry.ts), so scope the shared-project count by matching the
 * requesting company's own chatId inside that path string.
 */

import { getAinativeApiKey } from '@/lib/build/env-keys'
import { resolveCompanyZerodbKey } from '@/lib/build/company-zerodb-credentials'

const ZERODB_API = process.env.ZERODB_API_URL || 'https://api.ainative.studio/api'
const SHARED_PROJECT_ID = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'

function getApiKey(): string {
  return getAinativeApiKey()
}

async function queryVisitorRows(
  projectId: string,
  filters: Record<string, unknown>,
  apiKey: string,
): Promise<any[] | null> {
  try {
    const res = await fetch(
      `${ZERODB_API}/v1/projects/${projectId}/database/tables/visitors/query`,
      {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters, limit: 500 }),
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

export interface VisitorEntry {
  path: string
  visitedAt: string
}

function toEntries(rows: any[] | null): VisitorEntry[] {
  if (!rows) return []
  return rows
    .map((r) => r?.row_data || r)
    .filter((rd): rd is Record<string, unknown> => !!rd)
    .map((rd) => ({ path: String(rd.path ?? ''), visitedAt: String(rd.ts ?? rd.visitedAt ?? '') }))
    .sort((a, b) => b.visitedAt.localeCompare(a.visitedAt))
}

/**
 * Real pageview entries for a company, newest first. Returns [] (never
 * fabricated) for a never-visited app or any read failure — an honest empty
 * state, exactly like waitlist-metrics.ts's listWaitlist().
 *
 * `projectId` — the company's OWN ZeroDB project, when provisioned (reads
 * every row there directly, no scoping needed — the table itself is already
 * private to that company). `chatId` — required to correctly scope entries
 * in the SHARED project (used when `projectId` is absent): matches only rows
 * whose recorded `path` contains this exact chatId, so one company's entries
 * never include another unprovisioned company's visitors.
 *
 * KEY SCOPING (#806, mirrored verbatim from the original countVisitors): the
 * per-project branch needs that project's OWN stored key
 * (company-zerodb-credentials.ts) — the shared service key is NEVER used
 * against a per-company project.
 */
export async function listVisitors(
  projectId: string | undefined | null,
  chatId?: string | undefined | null,
): Promise<VisitorEntry[]> {
  if (projectId && projectId !== SHARED_PROJECT_ID) {
    const key = await resolveCompanyZerodbKey(projectId).catch(() => ({ ok: false } as const))
    if (!key.ok || !key.apiKey) return []
    const rows = await queryVisitorRows(projectId, {}, key.apiKey)
    return toEntries(rows)
  }
  if (projectId) {
    // The company's project IS the shared project — the shared key is the
    // correctly-scoped key for it.
    const rows = await queryVisitorRows(projectId, {}, getApiKey())
    return toEntries(rows)
  }
  if (!chatId) return []
  const rows = await queryVisitorRows(SHARED_PROJECT_ID, {}, getApiKey())
  if (!rows) return []
  const matching = rows.filter((r) => {
    const path = String(r?.row_data?.path || r?.path || '')
    return path.includes(chatId)
  })
  return toEntries(matching)
}

/**
 * Count of real pageviews — the hero-metric number. Delegates to
 * listVisitors() so the count and the founder-facing list (VisitorsPanel)
 * can never drift apart, mirroring waitlist-metrics.ts's countWaitlist().
 */
export async function countVisitors(
  projectId: string | undefined | null,
  chatId?: string | undefined | null,
): Promise<number> {
  return (await listVisitors(projectId, chatId)).length
}
