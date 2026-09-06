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

const ZERODB_API = process.env.ZERODB_API_URL || 'https://api.ainative.studio/api'
const SHARED_PROJECT_ID = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'

function getApiKey(): string {
  return process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || process.env.API_Key || ''
}

async function queryVisitorRows(projectId: string, filters: Record<string, unknown>): Promise<any[] | null> {
  try {
    const res = await fetch(
      `${ZERODB_API}/v1/projects/${projectId}/database/tables/visitors/query`,
      {
        method: 'POST',
        headers: { 'X-API-Key': getApiKey(), 'Content-Type': 'application/json' },
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

/**
 * Count real pageviews for a company. Returns 0 (never negative, never
 * fabricated) for a never-visited app or any read failure — an honest empty
 * state, exactly like every other metric store in this codebase.
 *
 * `projectId` — the company's OWN ZeroDB project, when provisioned (counts
 * every row there directly, no scoping needed — the table itself is already
 * private to that company). `chatId` — required to correctly scope a count
 * in the SHARED project (used when `projectId` is absent): matches only rows
 * whose recorded `path` contains this exact chatId, so one company's count
 * never includes another unprovisioned company's visitors.
 */
export async function countVisitors(
  projectId: string | undefined | null,
  chatId?: string | undefined | null,
): Promise<number> {
  if (projectId) {
    const rows = await queryVisitorRows(projectId, {})
    return rows ? rows.length : 0
  }
  if (!chatId) return 0
  const rows = await queryVisitorRows(SHARED_PROJECT_ID, {})
  if (!rows) return 0
  const matching = rows.filter((r) => {
    const path = String(r?.row_data?.path || r?.path || '')
    return path.includes(chatId)
  })
  return matching.length
}
