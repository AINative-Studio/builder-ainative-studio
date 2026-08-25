/**
 * Option B — loop enrollment store (#207). Tracks which companies are enrolled
 * in the nightly autonomous loop + the last run per company. Persisted to ZeroDB
 * (table: builder_loop_enrollments), reusing the same project/key the builder
 * already uses. Minimal: create/list/record-run.
 */

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY || ''
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const TABLE = 'builder_loop_enrollments'

export interface LoopEnrollment {
  companyId: string
  companyName: string
  track: 'app' | 'company'
  goal?: string
  /**
   * The owner key ({@link deriveOwnerKey}) captured at enrollment, so the nightly
   * loop can append the daily operational report (#64) to the SAME per-{owner,
   * company} scope the Documents library reads. Optional for backward-compat with
   * pre-#64 enrollments (their reports simply key by companyId alone).
   */
  ownerKey?: string
  enabled: boolean
  enrolledAt: string
  lastRunAt?: string
  lastTaskId?: string
  lastStatus?: string
}

function rowsUrl(): string {
  return `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${TABLE}/rows`
}
function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}
function configured(): boolean {
  return Boolean(API_KEY && PROJECT_ID)
}

/** Enroll a company in the nightly loop (idempotent-ish: appends a row). */
export async function enrollCompany(e: Omit<LoopEnrollment, 'enrolledAt' | 'enabled'>): Promise<boolean> {
  if (!configured()) return false
  try {
    const res = await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ row_data: { ...e, enabled: true, enrolledAt: new Date().toISOString() } }),
      signal: AbortSignal.timeout(20000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Record the outcome of a nightly run (appended as an event row for the dashboard). */
export async function recordRun(companyId: string, taskId: string | null, status: string): Promise<void> {
  if (!configured()) return
  try {
    await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        row_data: { kind: 'run', companyId, lastTaskId: taskId, lastStatus: status, lastRunAt: new Date().toISOString(), enabled: false },
      }),
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    /* non-fatal */
  }
}

/** List enabled enrollments (the nightly cron iterates these). Excludes run-event rows. */
export async function listEnrolled(): Promise<LoopEnrollment[]> {
  if (!configured()) return []
  try {
    const res = await fetch(`${rowsUrl()}?limit=500`, { headers: headers(), signal: AbortSignal.timeout(25000) })
    if (!res.ok) return []
    const raw = await res.text()
    const data = JSON.parse(raw)
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    return rows
      .map((r: { row_data?: LoopEnrollment & { kind?: string } }) => r.row_data)
      .filter((rd: (LoopEnrollment & { kind?: string }) | undefined): rd is LoopEnrollment =>
        Boolean(rd?.enabled) && rd?.kind !== 'run')
  } catch {
    return []
  }
}

export interface CompanyRun {
  companyId: string
  lastTaskId?: string | null
  lastStatus?: string
  lastRunAt?: string
}

/**
 * The most recent nightly run for a company (from the recorded run-event rows).
 * Returns null when the company isn't enrolled / has never run — the dashboard
 * then shows the honest "enroll to start the nightshift" state. Never fabricated.
 */
export async function getLastRun(companyId: string): Promise<CompanyRun | null> {
  if (!configured() || !companyId) return null
  try {
    const res = await fetch(`${rowsUrl()}?limit=500`, { headers: headers(), signal: AbortSignal.timeout(20000) })
    if (!res.ok) return null
    const data = JSON.parse(await res.text())
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    const runs = rows
      .map((r: { row_data?: CompanyRun & { kind?: string } }) => r.row_data)
      .filter((rd: (CompanyRun & { kind?: string }) | undefined): rd is CompanyRun =>
        rd?.kind === 'run' && rd?.companyId === companyId)
    if (!runs.length) return null
    runs.sort((a: CompanyRun, b: CompanyRun) => (b.lastRunAt || '').localeCompare(a.lastRunAt || ''))
    return runs[0]
  } catch {
    return null
  }
}

/**
 * Whether a company is enrolled in the nightly autonomous loop (#55). Used by the
 * Tasks panel to decide if the synthetic "Recurring" task should appear. Returns
 * false on any failure so the backlog degrades to no-recurring-row honestly.
 */
export async function isEnrolled(companyId: string): Promise<boolean> {
  if (!configured() || !companyId) return false
  try {
    const res = await fetch(`${rowsUrl()}?limit=500`, { headers: headers(), signal: AbortSignal.timeout(20000) })
    if (!res.ok) return false
    const data = JSON.parse(await res.text())
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    return rows
      .map((r: { row_data?: LoopEnrollment & { kind?: string } }) => r.row_data)
      .some((rd: (LoopEnrollment & { kind?: string }) | undefined) =>
        Boolean(rd?.enabled) && rd?.kind !== 'run' && rd?.companyId === companyId)
  } catch {
    return false
  }
}
