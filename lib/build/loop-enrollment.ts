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
  /**
   * Auto Mode (#58) — a user-initiated BOUNDED run has a duration + expiry, unlike
   * the open-ended nightly enrollment. Optional + additive: a plain nightly
   * enrollment leaves these unset and behaves exactly as before. When present,
   * `autoExpiresAt` is the ISO instant the bounded run ends (null ⇒ continuous).
   * See lib/build/auto-mode.ts for the run store + duration math.
   */
  autoDuration?: string
  autoExpiresAt?: string | null
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

/**
 * Enable/disable the nightly loop for a company (#57, Danger Zone → "pause the
 * company"). Disabling appends an enrollment row with enabled=false so listEnrolled
 * (which requires enabled=true) stops iterating this company — the cron then skips
 * it. Re-enabling re-enrolls it. Requires the companyName so the paused/resumed
 * row is self-describing for the dashboard. Returns false when the store is
 * unconfigured or the write fails.
 */
export async function setLoopEnabled(
  companyId: string,
  companyName: string,
  track: 'app' | 'company',
  enabled: boolean,
): Promise<boolean> {
  if (!configured() || !companyId) return false
  try {
    const res = await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        row_data: { companyId, companyName, track, enabled, enrolledAt: new Date().toISOString() },
      }),
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

/**
 * List enabled enrollments (the nightly cron iterates these). Excludes run-event
 * rows, and DEDUPES to one row per companyId (latest enrolledAt wins).
 *
 * Real bug (live, #64 nightly loop): this store is append-only — enrollCompany()
 * appends a new row on every call with no upsert semantics, by design, so an
 * enrollment's history is preserved. But nothing downstream ever collapsed that
 * history back down to "one company, one entry" before the nightly loop iterated
 * it: a company enrolled N times (e.g. multiple "Hire the swarm" clicks before the
 * enroll route was guarded — see app/api/build/enroll/route.ts) came back from
 * listEnrolled() as N separate entries, so the nightly-loop's `for (const e of
 * enrolled)` loop ran the FULL per-company pipeline (swarm dispatch, daily report
 * append, media routine, task resolution) once per duplicate — the confirmed root
 * cause of "Daily Operational Report" appearing 8-10x for a single real day.
 * Deduping here is the durable fix: it holds regardless of how a duplicate row
 * got written (this bug, a future caller, a retried request), and needs no
 * migration of the underlying append-only rows.
 */
export async function listEnrolled(): Promise<LoopEnrollment[]> {
  if (!configured()) return []
  try {
    const rows = await fetchAllRows()
    const enrollments: LoopEnrollment[] = rows
      .map((r: { row_data?: LoopEnrollment & { kind?: string } }) => r.row_data)
      .filter((rd: (LoopEnrollment & { kind?: string }) | undefined): rd is LoopEnrollment =>
        Boolean(rd?.enabled) && rd?.kind !== 'run')
    return dedupeByCompany(enrollments)
  } catch {
    return []
  }
}

/**
 * Page through every row in the append-only enrollment store. Real bug: this
 * store never upserts (enrollCompany appends on every "Hire the swarm" /
 * START AUTO MODE click) and had grown past a single 500-row page in
 * production — a fixed `?limit=500` single fetch silently clips whichever
 * rows fall past the page boundary, which could drop a real, currently-
 * enrolled company from the nightly loop with no error or signal. Paginates
 * with a hard cap (not truly unbounded) so a pathological table still can't
 * hang the cron.
 */
const MAX_ENROLLMENT_PAGES = 20
const ENROLLMENT_PAGE_SIZE = 500

async function fetchAllRows(): Promise<Array<{ row_data?: LoopEnrollment & { kind?: string } }>> {
  const all: Array<{ row_data?: LoopEnrollment & { kind?: string } }> = []
  for (let page = 0; page < MAX_ENROLLMENT_PAGES; page++) {
    const skip = page * ENROLLMENT_PAGE_SIZE
    const res = await fetch(`${rowsUrl()}?limit=${ENROLLMENT_PAGE_SIZE}&skip=${skip}`, {
      headers: headers(),
      signal: AbortSignal.timeout(25000),
    })
    if (!res.ok) break
    const raw = await res.text()
    const data = JSON.parse(raw)
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    all.push(...rows)
    const hasMore = Array.isArray(data) ? rows.length === ENROLLMENT_PAGE_SIZE : Boolean(data?.has_more)
    if (!hasMore || rows.length < ENROLLMENT_PAGE_SIZE) break
  }
  return all
}

/**
 * Collapse a list of enrollment rows down to the single latest row per companyId
 * (by enrolledAt, falling back to array order when timestamps tie/are missing).
 * Pure — unit-testable without a network. Exported so the exact dedup rule the
 * nightly loop depends on is directly testable.
 */
export function dedupeByCompany(enrollments: LoopEnrollment[]): LoopEnrollment[] {
  const latestByCompany = new Map<string, LoopEnrollment>()
  for (const e of enrollments) {
    if (!e?.companyId) continue
    const current = latestByCompany.get(e.companyId)
    if (!current || (e.enrolledAt || '') >= (current.enrolledAt || '')) {
      latestByCompany.set(e.companyId, e)
    }
  }
  return [...latestByCompany.values()]
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
