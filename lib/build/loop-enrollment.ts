/**
 * Option B — loop enrollment store (#207). Tracks which companies are enrolled
 * in the nightly autonomous loop + the last run per company. Persisted to ZeroDB
 * (table: builder_loop_enrollments), reusing the same project/key the builder
 * already uses. Minimal: create/list/record-run.
 */

import { getAinativeApiKey } from '@/lib/build/env-keys'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = getAinativeApiKey()
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

/**
 * Backfill a stale/missing `ownerKey` on an ALREADY-enrolled company (found
 * during the #2089 wrench/tidemark nightly-loop-stall investigation).
 *
 * THE BUG: a company's FIRST enrollment often happens before it has a real
 * owner — register-app auto-enrolls EVERY registration, including a wholly
 * anonymous one, with `ownerKey: ownerEmail`, which is undefined for an
 * anonymous build. Once that first row exists, `isEnrolled()` guards every
 * later `enrollCompany()` call site (register-app on a later regen,
 * subscription/verify at checkout, auto-mode's "Start Auto Mode") from ever
 * re-enrolling the company — so even after `setAppOwner()` later stamps the
 * founder's REAL email onto the app-registry row (checkout, provisioning),
 * this append-only enrollment store's `ownerKey` is never updated to match.
 *
 * Why this matters: every per-company step the nightly loop actually does —
 * media routines, backlog-task seeding, and (most importantly)
 * `runTaskResolutions()` itself — is gated behind `if (e.ownerKey)` in
 * app/api/build/nightly-loop/route.ts, and the `scopeKey` every one of
 * those steps uses is `chatScopeKey(e.ownerKey, e.companyId)`. A company
 * stuck with a stale/empty `ownerKey` either (a) never gets ANY of that
 * work done again (the `if` guard is false), or (b) gets it done under the
 * WRONG scope — invisible to a real backlog task filed against the
 * company's correct, CURRENT ownerEmail scope (obedience-backfill.ts, the
 * chat-ws obedience gate, etc.). Either way, a real, filed task can sit
 * forever with zero chance of the nightly loop ever reaching it, with no
 * error or signal anywhere.
 *
 * Fix: whenever a caller confirms a company's real ownerEmail
 * (`setAppOwner`, or register-app's own session-derived stamp), also call
 * this so the enrollment row's `ownerKey` catches up — appending a
 * corrected row (same append-only convention as `setLoopEnabled`/
 * `enrollCompany`) that carries the existing enrollment's other fields
 * forward unchanged. A no-op (returns `true`, nothing written) when the
 * company isn't enrolled yet (nothing to fix — the next real
 * `enrollCompany()` call will carry the correct key from the start) or its
 * latest row already carries this exact `ownerKey`.
 */
export async function syncEnrollmentOwnerKey(companyId: string, ownerKey: string): Promise<boolean> {
  const key = (ownerKey || '').trim().toLowerCase()
  if (!configured() || !companyId || !key) return false
  try {
    const rows = await fetchAllRows()
    const own = rows
      .map((r) => r.row_data as (LoopEnrollment & { kind?: string }) | undefined)
      .filter(
        (rd): rd is LoopEnrollment & { kind?: string } =>
          Boolean(rd) && rd!.companyId === companyId && rd!.kind !== 'run' && rd!.kind !== 'run_health',
      )
    if (!own.length) return true
    own.sort((a, b) => (b.enrolledAt || '').localeCompare(a.enrolledAt || ''))
    const latest = own[0]
    if ((latest.ownerKey || '').trim().toLowerCase() === key) return true

    const res = await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        row_data: {
          companyId: latest.companyId,
          companyName: latest.companyName,
          track: latest.track,
          goal: latest.goal,
          ownerKey: key,
          enabled: latest.enabled,
          enrolledAt: new Date().toISOString(),
          autoDuration: latest.autoDuration,
          autoExpiresAt: latest.autoExpiresAt,
        },
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
      .map((r) => r.row_data as (LoopEnrollment & { kind?: string }) | undefined)
      .filter((rd): rd is LoopEnrollment => Boolean(rd?.enabled) && rd?.kind !== 'run')
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

async function fetchAllRows(): Promise<Array<{ row_data?: Record<string, unknown> }>> {
  const all: Array<{ row_data?: Record<string, unknown> }> = []
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
    const rows = await fetchAllRows()
    const runs = rows
      .map((r) => r.row_data as (CompanyRun & { kind?: string }) | undefined)
      .filter((rd): rd is CompanyRun => rd?.kind === 'run' && rd?.companyId === companyId)
    if (!runs.length) return null
    runs.sort((a, b) => (b.lastRunAt || '').localeCompare(a.lastRunAt || ''))
    return runs[0]
  } catch {
    return null
  }
}

/**
 * The company's most recent nightly runs, newest-first (#1055).
 *
 * `getLastRun()` above returns only the single latest run, which is exactly
 * why the agent-swarm stall was invisible: one run in isolation always looks
 * fine ("dispatched"), and the real signal — the last N nights in a row all
 * dispatching a task that never finished — needs the recent HISTORY. The
 * append-only run rows already hold it (`recordRun` writes one per company
 * per night with its real `lastTaskId`); nothing had ever read more than the
 * newest one back.
 *
 * Returns at most `limit` rows, only those carrying a real `lastTaskId`
 * (a 'skipped'/'error' run with no task id has nothing to check a status
 * for). Empty on any failure — the caller then honestly reports
 * "not assessed" rather than guessing.
 */
export async function listRecentRuns(companyId: string, limit = 6): Promise<CompanyRun[]> {
  if (!configured() || !companyId) return []
  try {
    const rows = await fetchAllRows()
    const runs: CompanyRun[] = rows
      .map((r) => r.row_data as (CompanyRun & { kind?: string }) | undefined)
      .filter((rd): rd is CompanyRun =>
        rd?.kind === 'run' && rd?.companyId === companyId && Boolean(rd?.lastTaskId))
    runs.sort((a, b) => (b.lastRunAt || '').localeCompare(a.lastRunAt || ''))
    return runs.slice(0, Math.max(0, limit))
  } catch {
    return []
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
    const rows = await fetchAllRows()
    const enrollments = rows
      .map((r) => r.row_data as (LoopEnrollment & { kind?: string }) | undefined)
      .filter((rd): rd is LoopEnrollment => Boolean(rd) && rd!.kind !== 'run')
    const latest = dedupeByCompany(enrollments).find((e) => e.companyId === companyId)
    return Boolean(latest?.enabled)
  } catch {
    return false
  }
}

/**
 * Per-invocation aggregate health for one nightly-loop sweep (#1130). Every
 * field here is already computed by app/api/build/nightly-loop/route.ts before
 * it builds its JSON response — this just gives that aggregate a persisted
 * home, the same way an individual company's outcome gets one via recordRun().
 *
 * Before #1110 (nightly-loop's cutover from a GitHub Actions matrix to 4
 * staggered Railway cron shards), this aggregate at least reached the
 * Action's own job logs. Railway cron calls the route directly, so since then
 * it's only ever been returned in the HTTP response and passed to
 * logger.info/warn — neither reachable from a session with no Railway log
 * access. A shard that's silently gone unhealthy (budgetExhausted every
 * night, stalledCompanies climbing) had no way to be noticed except manually
 * sampling individual companies' own task records one at a time.
 */
export interface NightlyRunHealth {
  recordedAt: string
  shardIndex: number | null
  shardCount: number | null
  enrolled: number
  processed: number
  deferred: number
  budgetExhausted: boolean
  dispatched: number
  failed: number
  tasksAttempted: number
  tasksCompleted: number
  /**
   * #1232 — real ship rate, not just coverage-pass rate: how many of
   * tasksCompleted's coverage-verified tasks were actually auto-merged to
   * main / redeployed to the founder's live app (resolveTask()'s own
   * best-effort merge+deploy, #468, never flips completed back to failed on
   * a hiccup — so completed alone can look healthy while PRs sit unmerged).
   * Optional so an older/pre-#1232 row is never mistaken for an explicit 0.
   */
  tasksMerged?: number
  tasksRedeployed?: number
  /**
   * How many orphaned `in_progress` tasks (a prior run killed mid-resolution
   * — see task-resolution-loop.ts's isStaleInProgress) were recovered to
   * `failed` this run. Optional for the same reason as tasksMerged/
   * tasksRedeployed — an older/pre-this-field row is never mistaken for an
   * explicit 0.
   */
  tasksReaped?: number
  /**
   * #1914 — of tasksCompleted, how many were accepted via
   * decideOutcomeFromCoverage's no-test-suite path (no real test suite to
   * run, "accepted on implementation, not coverage-gated") rather than a
   * genuinely run, passing coverage check. Today this is the common case,
   * not the exception, and `mergeTaskPR()` auto-merges a `completed` task
   * either way — so this field lets a human reading this aggregate tell
   * "proven to work" apart from "merely committed and hoped for," which
   * tasksCompleted alone cannot. Optional for the same reason as
   * tasksMerged/tasksRedeployed/tasksReaped — an older/pre-this-field row is
   * never mistaken for an explicit 0.
   */
  tasksCompletedNoCoverage?: number
  /**
   * #2105 — attempted but ran out of this run's shared maxDuration budget
   * before resolveTask() finished; returned to `todo` immediately for next
   * run's retry rather than left `in_progress` for a day-later stale-reap to
   * discover as a crash. Optional for the same reason as the siblings
   * above — an older/pre-this-field row is never mistaken for an explicit 0.
   */
  tasksDeferred?: number
  stalledCompanies: number
  elapsedMs: number
  /**
   * Set only when the route's whole invocation threw before it could
   * finish aggregating a real outcome (see app/api/build/nightly-loop/
   * route.ts's catch block) -- every other field above is then a zeroed
   * placeholder, not a real measurement. Absent (not false) on every
   * normal recording, so an older/normal row is never mistaken for an
   * explicit "this run did not crash" assertion.
   */
  crashed?: boolean
  /** Only present alongside crashed: true. */
  errorMessage?: string
}

/** Persist one shard invocation's aggregate health. Best-effort, like recordRun(). */
export async function recordRunHealth(h: Omit<NightlyRunHealth, 'recordedAt'>): Promise<void> {
  if (!configured()) return
  try {
    await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        row_data: { kind: 'run_health', ...h, recordedAt: new Date().toISOString(), enabled: false },
      }),
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    /* non-fatal */
  }
}

/**
 * The most recent nightly-loop run-health rows, newest first — one per shard
 * invocation. Returns [] on any failure (unconfigured store, network hiccup)
 * so a caller degrades to "no health data" honestly rather than guessing.
 */
export async function listRecentRunHealth(limit = 20): Promise<NightlyRunHealth[]> {
  if (!configured()) return []
  try {
    const rows = await fetchAllRows()
    const health: NightlyRunHealth[] = rows
      .map((r) => r.row_data as (NightlyRunHealth & { kind?: string }) | undefined)
      .filter((rd): rd is NightlyRunHealth => rd?.kind === 'run_health')
    health.sort((a, b) => (b.recordedAt || '').localeCompare(a.recordedAt || ''))
    return health.slice(0, Math.max(0, limit))
  } catch {
    return []
  }
}
