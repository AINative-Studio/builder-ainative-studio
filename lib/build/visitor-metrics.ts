/**
 * Visitor metrics (#483/#563) — the real count behind the Live dashboard's
 * "visitors" hero metric.
 *
 * Real gap fix: the dashboard showed a permanent, hardcoded 0 with the copy
 * "Live from day one — Cody grows these nightly," but nothing anywhere ever
 * grew it — no generated app fired a pageview, and no route ever read one
 * back. The write side is the mandated `/api/db/visitors` beacon every
 * generated landing page now fires on mount (see primitive-catalog.ts's
 * FOUNDATION block + obedience-gate.ts's `hasVisitorTrackingGap`); this
 * module is the read side — counting real rows in the company's OWN ZeroDB
 * project (the same one `/api/db/visitors` writes into via the per-app data
 * token), never a shared/global pool.
 */

const ZERODB_API = process.env.ZERODB_API_URL || 'https://api.ainative.studio/api'

function getApiKey(): string {
  return process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || process.env.API_Key || ''
}

/**
 * Count rows in a company's own `visitors` table. Returns 0 (never negative,
 * never fabricated) for an unprovisioned company, a never-visited app, or any
 * read failure — an honest empty state, exactly like every other metric
 * store in this codebase (chat/tasks/documents/media).
 */
export async function countVisitors(projectId: string | undefined | null): Promise<number> {
  if (!projectId) return 0
  try {
    const res = await fetch(
      `${ZERODB_API}/v1/projects/${projectId}/database/tables/visitors/rows?limit=1`,
      { headers: { 'X-API-Key': getApiKey() }, signal: AbortSignal.timeout(10_000) },
    )
    if (!res.ok) return 0
    const data = await res.json().catch(() => null)
    const total = typeof data?.total === 'number' ? data.total : null
    if (total !== null) return Math.max(0, total)
    // Defensive floor only — `total` is confirmed reliable on the real rows-list
    // response regardless of `limit` (verified live), so this only fires if the
    // response ever comes back in some other, unexpected shape. Counting the
    // (limit=1-capped) returned rows is a real but incomplete lower bound.
    const rows = Array.isArray(data) ? data : data?.data || data?.rows || []
    return Array.isArray(rows) ? rows.length : 0
  } catch {
    return 0
  }
}
