/**
 * Auto Mode (#58) — user-set autonomous run duration.
 *
 * "Polsia works nonstop. You choose how long." The founder picks a bounded window
 * (1h / 4h / 8h / overnight / continuous) and STARTS a real autonomous run: the
 * swarm is dispatched on an interval across that window, on top of the SAME loop
 * primitives already used by the nightly cron (autonomous-loop.ts) and the same
 * enrollment store (loop-enrollment.ts, `builder_loop_enrollments`).
 *
 * This module is the PURE core — no network, no React — so the duration math,
 * expiry, credit cost, and dispatch-cadence logic are fully unit-testable. The
 * ZeroDB-backed run store (start/stop/status) lives alongside as thin I/O that
 * composes these helpers. The API route (app/api/build/auto-mode) and the
 * AutoModePanel both consume this, so the browser, the endpoint, and an
 * agent-triggered call all agree on the numbers.
 */

import { appendRecentEvent, type AutoRunEvent } from '@/lib/build/auto-run-activity'

/** Reuses the SAME table as the nightly loop (#207); Auto Mode rows carry kind: 'auto'. */
const TABLE = 'builder_loop_enrollments'

// Env is read at CALL time (not module load) so the run store honours env set by a
// process AND is testable — a test can toggle configured-ness per case.
function apiBase(): string {
  return process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
}
function apiKey(): string {
  return process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY || ''
}
function projectId(): string {
  return process.env.ZERODB_PROJECT_ID || ''
}

/** The five durations the founder can pick, mirroring Polsia's Auto Mode modal. */
export const AUTO_DURATIONS = ['1h', '4h', '8h', 'overnight', 'continuous'] as const
export type AutoDuration = (typeof AUTO_DURATIONS)[number]

/** Human label for each duration (UI + agent-facing). */
export const DURATION_LABELS: Record<AutoDuration, string> = {
  '1h': '1 hour',
  '4h': '4 hours',
  '8h': '8 hours',
  overnight: 'Overnight (8h)',
  continuous: 'Continuous',
}

/**
 * Window length in HOURS for each duration. `continuous` has no fixed end — we
 * model it as null (an open-ended run the founder must stop). `overnight` is 8h.
 */
export const DURATION_HOURS: Record<AutoDuration, number | null> = {
  '1h': 1,
  '4h': 4,
  '8h': 8,
  overnight: 8,
  continuous: null,
}

/**
 * How often the swarm is dispatched inside the window, in MINUTES. One dispatch
 * per 30 minutes — the same cadence the nightly loop uses per company, applied
 * across the chosen window rather than once per night.
 */
export const DISPATCH_INTERVAL_MINUTES = 30

/**
 * Credits charged per swarm dispatch. Shown transparently in the UI (like Polsia
 * shows cost) so a founder always knows what a run will cost before starting.
 */
export const CREDITS_PER_DISPATCH = 10

/** For an open-ended `continuous` run, the cost line is quoted per-hour. */
export const CONTINUOUS_DISPATCHES_PER_HOUR = 60 / DISPATCH_INTERVAL_MINUTES

/** Type guard — is `v` one of the five known durations? */
export function isAutoDuration(v: unknown): v is AutoDuration {
  return typeof v === 'string' && (AUTO_DURATIONS as readonly string[]).includes(v)
}

/**
 * Coerce arbitrary input to a valid duration, defaulting to '1h'. Accepts a few
 * loose aliases (e.g. 'night' → 'overnight', '60m' → '1h') so an agent calling the
 * endpoint with a natural value still lands on a real duration.
 */
export function normalizeDuration(v: unknown): AutoDuration {
  if (isAutoDuration(v)) return v
  const s = String(v ?? '').trim().toLowerCase()
  if (s === '60m' || s === '1hr' || s === 'hour') return '1h'
  if (s === '4hr' || s === '240m') return '4h'
  if (s === '8hr' || s === '480m') return '8h'
  if (s === 'night' || s === 'nightly') return 'overnight'
  if (s === 'nonstop' || s === 'forever' || s === 'unbounded') return 'continuous'
  return '1h'
}

/**
 * The number of swarm dispatches that fit in a bounded window: one per interval
 * that STARTS inside the half-open window [start, end). At a 30m cadence a 1h
 * window has dispatches for [0,30) and [30,60) = 2; a 4h window = 8; 8h = 16. A
 * dispatch at exactly t=end does NOT count (the run is over). `continuous` returns
 * null (unbounded — no fixed total). Never below 1 for a bounded window.
 */
export function plannedDispatches(duration: AutoDuration): number | null {
  const hours = DURATION_HOURS[duration]
  if (hours == null) return null
  const windowMin = hours * 60
  return Math.max(1, Math.ceil(windowMin / DISPATCH_INTERVAL_MINUTES))
}

/**
 * Estimated credit cost for a run. For a bounded window it's dispatches × per-run
 * cost. For `continuous` there's no total, so we return a per-hour rate instead —
 * the UI renders "≈ N credits/hour" and a bounded window renders "≈ N credits".
 */
export function estimateCreditCost(
  duration: AutoDuration,
): { total: number | null; perHour: number } {
  const perHour = CONTINUOUS_DISPATCHES_PER_HOUR * CREDITS_PER_DISPATCH
  const dispatches = plannedDispatches(duration)
  return { total: dispatches == null ? null : dispatches * CREDITS_PER_DISPATCH, perHour }
}

/** A one-line, human cost label used by the UI + returned by the endpoint. */
export function creditCostLabel(duration: AutoDuration): string {
  const { total, perHour } = estimateCreditCost(duration)
  return total == null ? `≈ ${perHour} credits/hour` : `≈ ${total} credits`
}

/**
 * Compute the absolute expiry ISO for a run that STARTS at `startedAtMs`. Bounded
 * windows expire startedAt + hours; `continuous` never expires (null).
 */
export function computeExpiry(duration: AutoDuration, startedAtMs: number): string | null {
  const hours = DURATION_HOURS[duration]
  if (hours == null) return null
  return new Date(startedAtMs + hours * 3.6e6).toISOString()
}

export interface AutoRunProgress {
  /** Whether the run is still active RIGHT NOW (not expired, not stopped). */
  running: boolean
  /** Milliseconds remaining until expiry; null for a continuous (or stopped) run. */
  msRemaining: number | null
  /** Whole minutes remaining (ceil), null for continuous. */
  minutesRemaining: number | null
  /** A compact "2h 5m" / "45m" / "running" (continuous) / "ended" label. */
  timeLeftLabel: string
  /** Dispatches that SHOULD have fired by now given the cadence (for progress). */
  dispatchesSoFar: number
}

/**
 * Derive live progress for a run from its stored fields + the current time. This
 * is what the panel polls to render "time remaining / tasks dispatched / current
 * activity". Deterministic + pure so it's trivially testable with a fixed `nowMs`.
 *
 * A run is "running" iff it was started, not explicitly stopped, and (for a
 * bounded window) not past its expiry. `dispatchesSoFar` is clamped to the planned
 * total for a bounded run so it never over-reports.
 */
export function runProgress(
  run: {
    duration: AutoDuration
    startedAt?: string | null
    expiresAt?: string | null
    stoppedAt?: string | null
  } | null,
  nowMs: number,
): AutoRunProgress {
  const idle: AutoRunProgress = {
    running: false, msRemaining: null, minutesRemaining: null, timeLeftLabel: 'off', dispatchesSoFar: 0,
  }
  if (!run || !run.startedAt) return idle
  const startedMs = new Date(run.startedAt).getTime()
  if (!Number.isFinite(startedMs)) return idle

  const stopped = Boolean(run.stoppedAt)
  const expiresMs = run.expiresAt ? new Date(run.expiresAt).getTime() : null
  const expired = expiresMs != null && Number.isFinite(expiresMs) && nowMs >= expiresMs
  const running = !stopped && !expired

  // Dispatches that should have fired between start and the effective "now"
  // (capped at expiry / stop). One at t=0, then one per interval.
  const effectiveEnd = stopped
    ? Math.min(nowMs, new Date(run.stoppedAt as string).getTime())
    : expiresMs != null && expired
      ? expiresMs
      : nowMs
  const elapsedMin = Math.max(0, (effectiveEnd - startedMs) / 60000)
  let dispatchesSoFar = 1 + Math.floor(elapsedMin / DISPATCH_INTERVAL_MINUTES)
  const planned = plannedDispatches(run.duration)
  if (planned != null) dispatchesSoFar = Math.min(dispatchesSoFar, planned)
  dispatchesSoFar = Math.max(0, dispatchesSoFar)

  if (!running) {
    return { running: false, msRemaining: null, minutesRemaining: null, timeLeftLabel: stopped ? 'stopped' : 'ended', dispatchesSoFar }
  }
  if (expiresMs == null) {
    // continuous — no countdown, but it IS running.
    return { running: true, msRemaining: null, minutesRemaining: null, timeLeftLabel: 'running', dispatchesSoFar }
  }
  const msRemaining = Math.max(0, expiresMs - nowMs)
  const minutesRemaining = Math.ceil(msRemaining / 60000)
  return { running: true, msRemaining, minutesRemaining, timeLeftLabel: formatTimeLeft(msRemaining), dispatchesSoFar }
}

/** "2h 5m" / "45m" / "under a minute" from a millisecond remainder. */
export function formatTimeLeft(ms: number): string {
  if (ms <= 0) return 'ended'
  if (ms < 60000) return 'under a minute'
  const totalMin = Math.ceil(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h <= 0) return `${m}m`
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// ---------------------------------------------------------------------------
// ZeroDB-backed run store — thin I/O layered on the pure helpers above. Rows are
// appended to the SAME builder_loop_enrollments table (kind: 'auto') so Auto Mode
// reuses the existing store additively; the latest 'auto' row per company is the
// current run. A stop appends a row with stoppedAt set.
// ---------------------------------------------------------------------------

export interface AutoRun {
  kind: 'auto'
  companyId: string
  companyName?: string
  duration: AutoDuration
  startedAt: string
  expiresAt: string | null
  stoppedAt?: string | null
  /** Owner key (server-derived) so the run is scoped like every other store. */
  ownerKey?: string
  /**
   * Event trail (#340): the last MAX_RECENT_EVENTS things this run actually did
   * (task dispatched / shipped / failed), appended by the dispatch path. Rides
   * along on GET /api/build/auto-mode automatically — the Live swarm card + the
   * per-company ribbon read it. Absent on pre-#340 rows.
   */
  recentEvents?: AutoRunEvent[]
  /**
   * Set when a row is an event-append update of the SAME run — later than
   * startedAt so latestAutoRun picks the freshest snapshot of the run.
   */
  updatedAt?: string | null
}

function rowsUrl(): string {
  return `${apiBase()}/api/v1/projects/${projectId()}/database/tables/${TABLE}/rows`
}
function headers(): Record<string, string> {
  const key = apiKey()
  return { Authorization: `Bearer ${key}`, 'X-API-Key': key, 'Content-Type': 'application/json' }
}
/** Whether the run store is wired (key + project). When false, Auto Mode is inert. */
export function autoModeConfigured(): boolean {
  return Boolean(apiKey() && projectId())
}

/** Start a bounded Auto Mode run — appends an 'auto' row. Returns the run or null. */
export async function startAutoRun(input: {
  companyId: string
  companyName?: string
  duration: AutoDuration
  ownerKey?: string
  nowMs?: number
}): Promise<AutoRun | null> {
  if (!autoModeConfigured() || !input.companyId) return null
  const now = input.nowMs ?? Date.now()
  const run: AutoRun = {
    kind: 'auto',
    companyId: input.companyId,
    companyName: input.companyName,
    duration: input.duration,
    startedAt: new Date(now).toISOString(),
    expiresAt: computeExpiry(input.duration, now),
    stoppedAt: null,
    ownerKey: input.ownerKey,
  }
  try {
    const res = await fetch(rowsUrl(), {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ row_data: run }),
      signal: AbortSignal.timeout(20000),
    })
    return res.ok ? run : null
  } catch {
    return null
  }
}

/** Stop the active run — appends an 'auto' row marked stopped. Returns success. */
export async function stopAutoRun(input: {
  companyId: string
  ownerKey?: string
  nowMs?: number
}): Promise<boolean> {
  if (!autoModeConfigured() || !input.companyId) return false
  const current = await getAutoRun(input.companyId)
  const now = input.nowMs ?? Date.now()
  const stopped: AutoRun = {
    kind: 'auto',
    companyId: input.companyId,
    companyName: current?.companyName,
    duration: current?.duration ?? '1h',
    startedAt: current?.startedAt ?? new Date(now).toISOString(),
    expiresAt: current?.expiresAt ?? null,
    stoppedAt: new Date(now).toISOString(),
    ownerKey: input.ownerKey ?? current?.ownerKey,
    // Carry the event trail (#340) onto the stop row so the run's history
    // survives the stop snapshot (the latest row always wins).
    recentEvents: current?.recentEvents,
  }
  try {
    const res = await fetch(rowsUrl(), {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ row_data: stopped }),
      signal: AbortSignal.timeout(20000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** The latest 'auto' run row for a company (start OR stop), or null. Never throws. */
export async function getAutoRun(companyId: string): Promise<AutoRun | null> {
  if (!autoModeConfigured() || !companyId) return null
  try {
    const res = await fetch(`${rowsUrl()}?limit=500`, { headers: headers(), signal: AbortSignal.timeout(20000) })
    if (!res.ok) return null
    const data = JSON.parse(await res.text())
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    return latestAutoRun(
      rows.map((r: { row_data?: AutoRun }) => r.row_data).filter(Boolean) as AutoRun[],
      companyId,
    )
  } catch {
    return null
  }
}

/**
 * Pick the most recent 'auto' row for a company from a list of row_data. Pure so
 * it's unit-tested directly. Latest by the row's own timestamp (stoppedAt for a
 * stop row, else updatedAt for an event-append row (#340), else startedAt) — so
 * a fresh stop always supersedes its start, and an event append supersedes the
 * plain start row it snapshots.
 */
export function latestAutoRun(rows: AutoRun[], companyId: string): AutoRun | null {
  const mine = rows.filter((r) => r?.kind === 'auto' && r.companyId === companyId)
  if (!mine.length) return null
  const stamp = (r: AutoRun) => new Date(r.stoppedAt || r.updatedAt || r.startedAt || 0).getTime()
  mine.sort((a, b) => stamp(b) - stamp(a))
  return mine[0]
}

/**
 * Append a run event (#340) to the ACTIVE run's recentEvents ring buffer — the
 * dispatch path calls this wherever a task is dispatched (auto-mode start's
 * immediate dispatch + the nightly-loop cron tick). Appends a NEW row that
 * snapshots the run with the event added and updatedAt bumped, so the latest
 * row (by stamp) always carries the full trail. No-op (null) when there is no
 * ACTIVE run for the company — a plain nightly enrollment without Auto Mode
 * never grows a trail. Best-effort: never throws.
 */
export async function appendAutoRunEvent(
  companyId: string,
  event: AutoRunEvent,
  nowMs?: number,
): Promise<AutoRun | null> {
  if (!autoModeConfigured() || !companyId) return null
  const now = nowMs ?? Date.now()
  const current = await getAutoRun(companyId)
  if (!current || !runProgress(current, now).running) return null
  const updated: AutoRun = {
    ...current,
    recentEvents: appendRecentEvent(current.recentEvents, event),
    updatedAt: new Date(now).toISOString(),
  }
  try {
    const res = await fetch(rowsUrl(), {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ row_data: updated }),
      signal: AbortSignal.timeout(20000),
    })
    return res.ok ? updated : null
  } catch {
    return null
  }
}
