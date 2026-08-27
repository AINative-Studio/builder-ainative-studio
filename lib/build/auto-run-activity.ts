/**
 * Auto Mode run activity (#340) — the founder's OWN swarm, visible.
 *
 * With Auto Mode running, the founder looked at the 'Hire the swarm' card and
 * the masthead expecting to see their agents' activity — and saw neither. This
 * module is the PURE core behind fixing that: the recentEvents ring buffer the
 * dispatch path appends to on the AutoRun record, the event→row mapping the
 * swarm card renders (workspace swarm grammar: mono title + status glyph), the
 * honest empty state (real pipeline stages, never fabricated agent names), and
 * the per-company masthead ribbon line in Cody's voice.
 *
 * No network, no React — fully unit-testable. The I/O append lives in
 * auto-mode.ts (appendAutoRunEvent); the UI reads via useAutoRun.
 */

/** An event's lifecycle on a dispatched run task. */
export type AutoRunEventStatus = 'dispatched' | 'shipped' | 'failed'

/** One run event — a task the run dispatched (and its outcome, when known). */
export interface AutoRunEvent {
  /** ISO timestamp the event landed. */
  ts: string
  /** Honest, compact task title — derived from the REAL dispatch, never invented. */
  title: string
  status: AutoRunEventStatus
}

/** Ring-buffer size — the run record keeps only the last N events. */
export const MAX_RECENT_EVENTS = 12

/** Loose runtime guard for an event read back from the store. */
export function isAutoRunEvent(v: unknown): v is AutoRunEvent {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  return (
    typeof e.ts === 'string' &&
    typeof e.title === 'string' &&
    (e.status === 'dispatched' || e.status === 'shipped' || e.status === 'failed')
  )
}

/**
 * Append `event` to the ring buffer, keeping only the newest MAX_RECENT_EVENTS.
 * Pure — returns a NEW array (never mutates), drops malformed prior entries, and
 * keeps events in append (oldest → newest) order so the newest is always last.
 */
export function appendRecentEvent(
  events: readonly unknown[] | null | undefined,
  event: AutoRunEvent,
): AutoRunEvent[] {
  const prior = (events ?? []).filter(isAutoRunEvent)
  const next = [...prior, event]
  return next.slice(Math.max(0, next.length - MAX_RECENT_EVENTS))
}

/**
 * The honest title for a swarm-dispatch event. Grounded ONLY in what actually
 * happened (the loop dispatches ONE highest-leverage task per interval, and the
 * swarm returns a task id) — no fabricated agent names.
 */
export function dispatchEventTitle(input: {
  track: 'app' | 'company'
  taskId?: string | null
}): string {
  const what = input.track === 'company' ? 'growth task' : 'product task'
  const id = input.taskId ? ` · task ${String(input.taskId).slice(0, 8)}` : ''
  return `highest-leverage ${what}${id}`
}

// ---------------------------------------------------------------------------
// Event → swarm-card row mapping (workspace swarm grammar).
// ---------------------------------------------------------------------------

/** A render-ready row for the live swarm card: mono title + status glyph. */
export interface ActivityRow {
  title: string
  status: AutoRunEventStatus
  /** Status glyph — ● dispatched / ✓ shipped / · failed. No icon libraries. */
  glyph: '●' | '✓' | '·'
  /** Existing m-agent-badge tone class (is-working / is-done / is-idle). */
  tone: 'is-working' | 'is-done' | 'is-idle'
  /** Existing .st pill tone (is-running / is-done / is-planned). */
  st: 'is-running' | 'is-done' | 'is-planned'
  ts: string
}

const ROW_LOOK: Record<AutoRunEventStatus, Pick<ActivityRow, 'glyph' | 'tone' | 'st'>> = {
  dispatched: { glyph: '●', tone: 'is-working', st: 'is-running' },
  shipped: { glyph: '✓', tone: 'is-done', st: 'is-done' },
  failed: { glyph: '·', tone: 'is-idle', st: 'is-planned' },
}

/**
 * Map the ring buffer to card rows, NEWEST FIRST (the card reads top-down),
 * capped at `limit` (default 6 so the card stays a card, not a log). Malformed
 * entries are dropped, never rendered.
 */
export function activityRows(
  events: readonly unknown[] | null | undefined,
  limit = 6,
): ActivityRow[] {
  return (events ?? [])
    .filter(isAutoRunEvent)
    .slice()
    .reverse()
    .slice(0, Math.max(0, limit))
    .map((e) => ({ title: e.title, status: e.status, ts: e.ts, ...ROW_LOOK[e.status] }))
}

// ---------------------------------------------------------------------------
// Empty state + per-company ribbon (Cody's voice, mono, no fabrication).
// ---------------------------------------------------------------------------

/**
 * Honest empty state while a run is ACTIVE but no events have landed yet — the
 * REAL pipeline stages (briefing → task selection), never invented agent names.
 */
export const ACTIVITY_EMPTY_LINE = 'briefing → picking the highest-leverage task'

/**
 * What the live section of the swarm card should show: real rows when events
 * exist, the honest pipeline-stage line while the run warms up, nothing when no
 * run is active (the card stays the plain upsell).
 */
export function activityState(
  running: boolean,
  events: readonly unknown[] | null | undefined,
): { mode: 'hidden' | 'empty' | 'rows'; rows: ActivityRow[] } {
  if (!running) return { mode: 'hidden', rows: [] }
  const rows = activityRows(events)
  return rows.length ? { mode: 'rows', rows } : { mode: 'empty', rows: [] }
}

/**
 * The per-company masthead ribbon line — the LATEST event narrated in Cody's
 * first-person mono voice. Returns the warm-up line when the run is active with
 * no events yet, and null when no run is active (the platform-wide proof ticker
 * stands alone). Augments the proof ticker, never replaces it.
 */
export function ribbonLine(
  running: boolean,
  events: readonly unknown[] | null | undefined,
  companyName: string,
): string | null {
  if (!running) return null
  const valid = (events ?? []).filter(isAutoRunEvent)
  const latest = valid[valid.length - 1]
  if (!latest) return `auto mode · ${companyName} — ${ACTIVITY_EMPTY_LINE}`
  const verb =
    latest.status === 'shipped'
      ? 'I shipped'
      : latest.status === 'failed'
        ? 'a dispatch failed —'
        : 'I dispatched'
  return `auto mode · ${companyName} — ${verb} ${latest.title}`
}
