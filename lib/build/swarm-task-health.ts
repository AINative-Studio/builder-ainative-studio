/**
 * Swarm task health — reading back what the agent swarm ACTUALLY did (#1055).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE REAL BUG THIS CLOSES (confirmed live, not hypothetical)
 * ──────────────────────────────────────────────────────────────────────────
 * Audited `mendr` (owner arif@8genc.com, core plan enterprise, enrolled
 * 2026-09-13). Nineteen real swarm tasks were dispatched Sept 14 – Oct 10.
 * Eleven completed early on; one failed Sept 27; and the SIX dispatched from
 * Sept 28 onward — including the day of the audit — were all still
 * `status: queued`. The swarm had not completed a single task for this
 * company in thirteen days.
 *
 * The founder was never told. `lib/build/autonomous-loop.ts`'s
 * `dispatchSwarmTask()` is dispatch-and-forget: it POSTs to core's
 * `/api/v1/public/agent-swarm/tasks`, keeps the returned `task_id`, and
 * nothing in this entire repository ever reads that id back. So every night
 * the nightly loop wrote a real "Daily Operational Report" to the founder's
 * Documents library saying "Loop status: dispatched" / "task queued for the
 * swarm" — true for that one run, and completely silent about the aggregate:
 * thirteen consecutive nights of zero delivered work.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT IS AND IS NOT FIXABLE IN THIS REPO
 * ──────────────────────────────────────────────────────────────────────────
 * The swarm EXECUTOR is not Builder's. `/api/v1/public/agent-swarm/tasks`
 * (dispatch) and `/api/v1/public/agent-swarm/tasks/{id}` (status) both live
 * on `api.ainative.studio`; the worker that claims a queued task is core's
 * own Celery consumer (`swarm_task_execution.py`). There is no agent-swarm
 * route under `app/api/` in this repo — Builder is purely a client. WHY the
 * queue stopped draining after Sept 27 therefore cannot be diagnosed or
 * fixed from here, and this module does not pretend otherwise.
 *
 * What IS fixable here is the invisibility, and that is all this module
 * does: read the real statuses of the recent dispatched task ids back from
 * core and compute an honest verdict the nightly loop can surface to the
 * founder. The verdict never invents progress and never invents a stall —
 * a status that cannot be read is reported as `unknown`, which counts as
 * neither.
 */

import { getAinativeApiKey } from '@/lib/build/env-keys'
import { mapWithConcurrency } from '@/lib/build/concurrent-map'

/**
 * How long a dispatched task may sit un-finished before the nightly loop
 * calls it a stall. A swarm task is meant to be overnight work: by the time
 * the NEXT nightly run fires (24h later) the previous night's task should
 * have reached a terminal state. 24h is therefore the smallest threshold
 * that cannot fire on a merely-slow-but-working run, which matters because
 * this flag is founder-facing — a false alarm on a healthy company is its
 * own kind of dishonesty.
 */
export const STALL_SLA_HOURS = Number(process.env.SWARM_STALL_SLA_HOURS || 24)

/**
 * How many recent task ids to check per company per nightly run. Each check
 * is a real HTTP call to core, and this runs for every enrolled company
 * inside one shared route budget — so it is capped rather than "all 19".
 * Six covers the real stall signal comfortably (mendr's unfinished streak
 * was exactly six) while keeping the added cost per company to a handful of
 * small, parallel GETs.
 */
export const MAX_TASKS_CHECKED = 6

/** Concurrency for the per-company status reads. Small: these are cheap GETs,
 *  but they multiply by the number of companies the sweep runs in parallel. */
const STATUS_CHECK_CONCURRENCY = 3

const STATUS_TIMEOUT_MS = 8000

/** A dispatched task whose status we want to read back. */
export interface DispatchedTaskRef {
  taskId: string
  /** ISO instant the nightly loop dispatched it (from the recorded run row). */
  dispatchedAt: string
}

/**
 * Normalized task lifecycle state. `unknown` is a first-class outcome, not an
 * error: it means core did not tell us, and must never be collapsed into
 * either "completed" (fabricating progress) or "queued" (fabricating a stall).
 */
export type SwarmTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'unknown'

export interface SwarmTaskState extends DispatchedTaskRef {
  status: SwarmTaskStatus
}

export interface SwarmHealthVerdict {
  /** How many task ids we actually got a status read for (0 ⇒ nothing assessed). */
  checked: number
  queued: number
  running: number
  completed: number
  failed: number
  unknown: number
  /**
   * How many of the MOST RECENT consecutive tasks are still un-finished
   * (queued or running), newest-first. This is the number a founder actually
   * needs: "the last N nights of work did not complete."
   */
  consecutiveUnfinished: number
  /** Age in hours of the oldest still-unfinished task (0 when none). */
  oldestQueuedHours: number
  /** ISO dispatch instant of the most recent COMPLETED task, if any. */
  lastCompletedAt: string | null
  /** The verdict: real, founder-worthy stall. See summarizeSwarmTaskStates. */
  stalled: boolean
}

const EMPTY_VERDICT: SwarmHealthVerdict = {
  checked: 0, queued: 0, running: 0, completed: 0, failed: 0, unknown: 0,
  consecutiveUnfinished: 0, oldestQueuedHours: 0, lastCompletedAt: null, stalled: false,
}

/** Map core's raw status string onto our normalized vocabulary. */
export function normalizeSwarmStatus(raw: unknown): SwarmTaskStatus {
  const s = String(raw || '').toLowerCase().trim()
  if (s === 'completed' || s === 'complete' || s === 'succeeded' || s === 'success' || s === 'done') return 'completed'
  if (s === 'failed' || s === 'failure' || s === 'error' || s === 'cancelled' || s === 'canceled') return 'failed'
  if (s === 'running' || s === 'in_progress' || s === 'in-progress' || s === 'started' || s === 'processing') return 'running'
  if (s === 'queued' || s === 'pending' || s === 'submitted' || s === 'waiting') return 'queued'
  return 'unknown'
}

function hoursSince(iso: string): number {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, (Date.now() - t) / (60 * 60 * 1000))
}

/**
 * Compute the honest verdict from already-read task states, newest-first.
 * PURE — the whole stall rule is unit-testable with no network.
 *
 * STALLED means, specifically: at least one of the most-recent consecutive
 * un-finished (queued/running) tasks has been sitting past STALL_SLA_HOURS.
 * Deliberate consequences of that definition:
 *
 *  - Tonight's own fresh dispatch sitting `queued` for an hour is NOT a
 *    stall. That is the normal, healthy shape every single night, and
 *    flagging it would make the signal worthless.
 *  - A run of `failed` tasks is NOT a stall. Those reached a terminal state;
 *    the queue is draining. They are surfaced separately via `failed` — a
 *    different problem with a different remedy, and conflating them would
 *    mis-describe what is wrong.
 *  - `unknown` counts as neither progress nor stall, so a core status
 *    endpoint outage can never manufacture a founder-facing alarm.
 */
export function summarizeSwarmTaskStates(states: readonly SwarmTaskState[]): SwarmHealthVerdict {
  if (!Array.isArray(states) || states.length === 0) return { ...EMPTY_VERDICT }

  const counts: Record<SwarmTaskStatus, number> = {
    queued: 0, running: 0, completed: 0, failed: 0, unknown: 0,
  }
  for (const s of states) {
    // Defensive: a hand-constructed state (or a future caller) could carry a
    // status outside the union — count it as `unknown` rather than minting a
    // new key that would then be absent from the verdict's own fields.
    const key: SwarmTaskStatus = s.status in counts ? s.status : 'unknown'
    counts[key] += 1
  }

  // `states` arrives newest-first (the caller sorts run rows by recency).
  let consecutiveUnfinished = 0
  for (const s of states) {
    if (s.status === 'queued' || s.status === 'running') consecutiveUnfinished += 1
    else break
  }

  const unfinished = states.filter((s) => s.status === 'queued' || s.status === 'running')
  const oldestQueuedHours = unfinished.length
    ? Math.max(...unfinished.map((s) => hoursSince(s.dispatchedAt)))
    : 0

  const completedStates = states.filter((s) => s.status === 'completed')
  const lastCompletedAt = completedStates.length
    ? completedStates
        .map((s) => s.dispatchedAt)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
    : null

  const stalled = consecutiveUnfinished > 0 && oldestQueuedHours >= STALL_SLA_HOURS

  return {
    checked: states.length,
    ...counts,
    consecutiveUnfinished,
    oldestQueuedHours: Math.round(oldestQueuedHours),
    lastCompletedAt,
    stalled,
  }
}

function ainativeApi(): string {
  return process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
}

/**
 * Read one task's real status from core's own agent-swarm status endpoint —
 * `GET /api/v1/public/agent-swarm/tasks/{id}`, the exact endpoint the live
 * audit used. Core-owned: this is a read of someone else's system, so every
 * failure mode (non-OK, unparseable, timeout, network down) degrades to
 * `unknown` rather than guessing. Never throws.
 *
 * Exported (beyond assessSwarmHealth's own aggregate use) so a caller that
 * needs ONE task's real current status — not the whole-company verdict — can
 * read it directly. First caller: the nightly loop's company-track backlog
 * seed (app/api/build/nightly-loop/route.ts), which updates the PRIOR night's
 * build_tasks row to its real stage before seeding tonight's.
 */
export async function readTaskStatus(ref: DispatchedTaskRef, key: string): Promise<SwarmTaskState> {
  try {
    const res = await fetch(
      `${ainativeApi()}/api/v1/public/agent-swarm/tasks/${encodeURIComponent(ref.taskId)}`,
      {
        headers: { Authorization: `Bearer ${key}`, 'X-API-Key': key },
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      },
    )
    if (!res.ok) return { ...ref, status: 'unknown' }
    const data = await res.json().catch(() => null)
    return { ...ref, status: normalizeSwarmStatus((data as any)?.status ?? (data as any)?.task_status) }
  } catch {
    return { ...ref, status: 'unknown' }
  }
}

/**
 * Check the recent dispatched tasks for one company and return the verdict.
 *
 * `refs` must be newest-first (the nightly loop passes the recorded run rows
 * sorted by `lastRunAt` descending). Capped at MAX_TASKS_CHECKED and read
 * with bounded concurrency so adding this check to every enrolled company
 * cannot reintroduce the very wall-clock problem #1055's other half fixes.
 *
 * Returns the empty verdict (and makes NO network call) when there is no API
 * key or nothing to check — honestly "not assessed", never "healthy".
 */
export async function assessSwarmHealth(refs: readonly DispatchedTaskRef[]): Promise<SwarmHealthVerdict> {
  const key = getAinativeApiKey()
  if (!key) return { ...EMPTY_VERDICT }

  const candidates = (refs || []).filter((r) => r && r.taskId).slice(0, MAX_TASKS_CHECKED)
  if (!candidates.length) return { ...EMPTY_VERDICT }

  const read = await mapWithConcurrency(
    candidates,
    STATUS_CHECK_CONCURRENCY,
    (ref) => readTaskStatus(ref, key),
  )

  const states: SwarmTaskState[] = read
    .map((r, i) => r.value ?? ({ ...candidates[i], status: 'unknown' as SwarmTaskStatus }))

  return summarizeSwarmTaskStates(states)
}
