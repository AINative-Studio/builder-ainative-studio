/**
 * Build task/backlog persistence (#55) — the company's REAL, stateful work queue
 * with lifecycle stages, surviving reload and re-login, keyed per {owner, company}.
 *
 * WHY: `components/build/screens/Live.tsx` shipped a hardcoded `tonight` array —
 * three display-only strings with no statuses and no lifecycle. Meanwhile the
 * swarm DOES dispatch real `task_id`s (`/api/build/swarm`, nightly-loop) but
 * nothing surfaced them as a managed backlog the founder could see/track. Polsia
 * has a full Tasks manager (status tabs + task cards + VIEW). We didn't. This
 * module backs a first-class Tasks list with our own primitive — a ZeroDB
 * `build_tasks` table — so it's durable and owned, mirroring the `build_chat`
 * store that just landed (see lib/build/chat-store.ts).
 *
 * SCOPE KEY: each task is keyed by {ownerKey}::{companySlug}, exactly like the
 * chat store — the authenticated user's email when signed in, else a stable
 * guest key. So a guest's backlog survives reload; once they log in, the migrate
 * flow re-owns their companies and future tasks key by email.
 *
 * The heavy I/O (ZeroDB) is isolated from the pure logic (stage normalization,
 * filtering, swarm-status → stage mapping, sort/dedup) so the pure core is
 * unit-testable without a network — same split as chat-store.
 */

import { deriveOwnerKey, chatScopeKey } from '@/lib/build/chat-store'

const ZERODB_API = process.env.ZERODB_API_URL || 'https://api.ainative.studio/api'
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
const TABLE_NAME = 'build_tasks'

/**
 * The six lifecycle stages a task can be in (Toby-specified). These are the
 * filter tabs and the badge on every task card.
 *  - todo:       queued, not started.
 *  - recurring:  scheduled/repeating work — the nightly loop, scheduled media.
 *  - in_progress the swarm/agent is actively working it (dispatched → running).
 *  - completed:  finished successfully.
 *  - rejected:   the founder or a gate declined it.
 *  - failed:     the agent tried and could not complete it.
 */
export const TASK_STAGES = [
  'todo',
  'recurring',
  'in_progress',
  'completed',
  'rejected',
  'failed',
] as const

export type TaskStage = (typeof TASK_STAGES)[number]

/** Where a task originated. Drives the source label on the card. */
export type TaskSource = 'cody' | 'swarm' | 'recurring'

/** Human labels for the stages (UI tabs + badges). */
export const STAGE_LABELS: Record<TaskStage, string> = {
  todo: 'To Do',
  recurring: 'Recurring',
  in_progress: 'In Progress',
  completed: 'Completed',
  rejected: 'Rejected',
  failed: 'Failed',
}

/** A single persisted build task. */
export interface BuildTask {
  /** Stable id (client-generated or platform task_id). */
  id: string
  /** Owner+company scope key this task belongs to. */
  scopeKey: string
  /** Short human title of the work. */
  title: string
  /** Longer detail — what the agent should do / did. Optional. */
  detail?: string
  /** Current lifecycle stage. */
  stage: TaskStage
  /** Where the task came from. */
  source: TaskSource
  /** The REAL platform task id once dispatched to the swarm (if any). */
  taskId?: string | null
  /** Agent output / result text once it runs (shown in VIEW). */
  output?: string
  /** ISO timestamp created. */
  createdAt: string
  /** ISO timestamp last updated (stage change, output). */
  updatedAt: string
}

/** Hard cap on how many tasks a single load returns (defends payload size). */
export const MAX_LOAD_TASKS = 200

function getApiKey(): string {
  return process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || process.env.API_Key || ''
}

// ---------------------------------------------------------------------------
// PURE LOGIC (no I/O) — unit-testable directly
// ---------------------------------------------------------------------------

/**
 * Resolve the durable scope key for a task list from a session + company slug.
 * Reuses the chat store's owner-key derivation + scope composition so a founder's
 * tasks and chat key identically (same owner, same company). Pure.
 */
export function taskScopeKey(
  session: Parameters<typeof deriveOwnerKey>[0],
  companySlug: string,
): string {
  return chatScopeKey(deriveOwnerKey(session), companySlug)
}

/**
 * Normalize an arbitrary stage-ish value to a valid TaskStage. Accepts common
 * aliases so external callers (and the platform swarm) can use loose vocabulary.
 * Unknown values fall back to 'todo'. Pure.
 */
export function normalizeStage(value: unknown): TaskStage {
  const s = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if ((TASK_STAGES as readonly string[]).includes(s)) return s as TaskStage
  switch (s) {
    case 'in_progress':
    case 'inprogress':
    case 'running':
    case 'active':
    case 'dispatched':
    case 'queued_run':
      return 'in_progress'
    case 'done':
    case 'complete':
    case 'success':
    case 'succeeded':
      return 'completed'
    case 'error':
    case 'errored':
    case 'cancelled':
    case 'canceled':
      return 'failed'
    case 'declined':
    case 'skipped':
      return 'rejected'
    case 'scheduled':
    case 'repeating':
    case 'nightly':
      return 'recurring'
    case 'backlog':
    case 'queued':
    case 'new':
    case 'pending':
      return 'todo'
    default:
      return 'todo'
  }
}

/**
 * Map a platform swarm/nightly status string to a lifecycle stage. The swarm
 * reports dispatched/queued/running/completed/failed; the nightly loop records
 * 'dispatched'. Pure — so the wiring in the routes is testable.
 */
export function stageFromSwarmStatus(status: unknown): TaskStage {
  const s = String(status || '').trim().toLowerCase()
  if (!s) return 'in_progress'
  if (/(complete|done|success|succeed)/.test(s)) return 'completed'
  if (/(fail|error|cancel)/.test(s)) return 'failed'
  if (/(reject|declin)/.test(s)) return 'rejected'
  // dispatched / queued / running / in_progress → actively being worked
  return 'in_progress'
}

/** Is `value` one of the six real stages? Pure. Used to validate filter input. */
export function isTaskStage(value: unknown): value is TaskStage {
  return (TASK_STAGES as readonly string[]).includes(String(value))
}

/**
 * Filter a task list by stage. A falsy / 'all' stage returns everything. An
 * unknown stage returns []. Pure.
 */
export function filterByStage(tasks: BuildTask[], stage?: string | null): BuildTask[] {
  const list = Array.isArray(tasks) ? tasks : []
  if (!stage || stage === 'all') return list
  if (!isTaskStage(stage)) return []
  return list.filter((t) => t.stage === stage)
}

/**
 * Count tasks per stage (for the tab badges), always returning a full record so
 * every tab shows a number (0 when empty). Pure.
 */
export function countByStage(tasks: BuildTask[]): Record<TaskStage, number> {
  const counts = Object.fromEntries(TASK_STAGES.map((s) => [s, 0])) as Record<TaskStage, number>
  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (isTaskStage(t?.stage)) counts[t.stage] += 1
  }
  return counts
}

/**
 * Coerce a raw ZeroDB row (or a partial input) into a valid BuildTask, filling
 * defaults and normalizing the stage/source. Returns null when the row has no
 * usable title (so garbage rows are dropped). Pure.
 */
export function coerceTask(raw: any, scopeKey = ''): BuildTask | null {
  const rd = raw?.row_data || raw
  if (!rd) return null
  const title = String(rd.title || '').trim()
  if (!title) return null
  const createdAt = String(rd.created_at || rd.createdAt || new Date().toISOString())
  const source: TaskSource =
    rd.source === 'swarm' || rd.source === 'recurring' ? rd.source : 'cody'
  return {
    id: String(rd.id || rd.task_id || `t_${createdAt}_${title.slice(0, 12)}`),
    scopeKey: String(rd.scope_key || rd.scopeKey || scopeKey),
    title: title.slice(0, 400),
    detail: rd.detail ? String(rd.detail).slice(0, 4000) : undefined,
    stage: normalizeStage(rd.stage),
    source,
    taskId: rd.task_id || rd.taskId || null,
    output: rd.output ? String(rd.output).slice(0, 8000) : undefined,
    createdAt,
    updatedAt: String(rd.updated_at || rd.updatedAt || createdAt),
  }
}

/**
 * Build the synthetic "Recurring" task that reflects the REAL nightly autonomous
 * loop for a company (#55 req 5). This is NOT fabricated: it's derived from the
 * enrollment/last-run signal the loop actually records. Returns null when the
 * company is not enrolled (honest — no recurring row appears). Pure so the
 * synthesis is unit-testable without hitting the loop store.
 *
 * @param scopeKey   the {owner, company} scope the task belongs to.
 * @param enrolled   whether the company is enrolled in the nightly loop.
 * @param lastRun    the most recent recorded run (taskId/status/runAt), if any.
 */
export function recurringTaskFromLoop(
  scopeKey: string,
  enrolled: boolean,
  lastRun: { lastTaskId?: string | null; lastStatus?: string; lastRunAt?: string } | null,
): BuildTask | null {
  if (!scopeKey || !enrolled) return null
  const runAt = lastRun?.lastRunAt || ''
  const nowIso = new Date().toISOString()
  const ranBefore = Boolean(runAt)
  const detail = ranBefore
    ? `The nightly autonomous loop last ran ${runAt} (status: ${lastRun?.lastStatus || 'dispatched'}). ` +
      `Each night Cody evaluates the company, picks the highest-leverage task, and dispatches it to the swarm.`
    : `Scheduled: each night Cody evaluates the company, picks the highest-leverage task, and dispatches it to the swarm. First run is scheduled tonight.`
  return {
    id: 'recurring:nightly-loop',
    scopeKey,
    title: 'Nightly autonomous loop',
    detail,
    stage: 'recurring',
    source: 'recurring',
    taskId: lastRun?.lastTaskId || null,
    output: ranBefore ? `Last dispatch: ${lastRun?.lastTaskId || 'n/a'} · ${lastRun?.lastStatus || 'dispatched'}` : undefined,
    createdAt: runAt || nowIso,
    updatedAt: runAt || nowIso,
  }
}

/**
 * Merge the synthetic recurring loop task into a persisted list, de-duplicated by
 * id (the synthetic recurring task always uses a stable id, so it never doubles
 * on repeated loads). The recurring task is placed first when present. Pure.
 */
export function withRecurringTask(tasks: BuildTask[], recurring: BuildTask | null): BuildTask[] {
  const list = (Array.isArray(tasks) ? tasks : []).filter((t) => t && t.id !== 'recurring:nightly-loop')
  return recurring ? [recurring, ...list] : list
}

/**
 * Sort tasks newest-updated first, so the freshest work is on top. Pure &
 * non-mutating.
 */
export function sortTasks(tasks: BuildTask[]): BuildTask[] {
  return [...(Array.isArray(tasks) ? tasks : [])].sort((a, b) =>
    (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''),
  )
}

// ---------------------------------------------------------------------------
// ZeroDB I/O — isolated from the pure logic above
// ---------------------------------------------------------------------------

async function zerodbRequest(
  method: string,
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<any> {
  const url = `${ZERODB_API}${path}`
  const timeoutMs = opts.timeoutMs ?? 12_000
  const retries = opts.retries ?? 0
  let lastErr: unknown = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'X-API-Key': getApiKey(), 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) {
        if (attempt < retries && (res.status === 401 || res.status === 429 || res.status >= 500)) continue
        return null
      }
      return await res.json()
    } catch (e) {
      lastErr = e
    }
  }
  if (lastErr) throw lastErr
  return null
}

/**
 * Create a task for a scope. Best-effort: returns the created BuildTask on
 * success, null on any failure (never throws) so a persistence hiccup can't
 * break the request. The stage/source are normalized before write.
 */
export async function createTask(
  scopeKey: string,
  input: {
    title: string
    detail?: string
    stage?: string
    source?: TaskSource
    taskId?: string | null
    output?: string
  },
): Promise<BuildTask | null> {
  const title = String(input?.title || '').trim()
  if (!scopeKey || !title) return null
  const now = new Date().toISOString()
  const id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const source: TaskSource =
    input.source === 'swarm' || input.source === 'recurring' ? input.source : 'cody'
  const row = {
    id,
    scope_key: scopeKey,
    title: title.slice(0, 400),
    detail: input.detail ? String(input.detail).slice(0, 4000) : '',
    stage: normalizeStage(input.stage),
    source,
    task_id: input.taskId || null,
    output: input.output ? String(input.output).slice(0, 8000) : '',
    created_at: now,
    updated_at: now,
  }
  try {
    const result = await zerodbRequest(
      'POST',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/rows`,
      { row_data: row },
    )
    if (!result) return null
    return coerceTask(row, scopeKey)
  } catch (e) {
    console.warn('[task-store] createTask failed:', (e as Error)?.name || e)
    return null
  }
}

/**
 * List tasks for a scope, newest-updated first, capped at `limit`. Returns [] on
 * empty / failure — an honest empty state for a new company, never fabricated.
 */
export async function listTasks(
  scopeKey: string,
  limit: number = MAX_LOAD_TASKS,
): Promise<BuildTask[]> {
  if (!scopeKey) return []
  const cap = Math.min(Math.max(1, limit), MAX_LOAD_TASKS)
  try {
    const result = await zerodbRequest(
      'POST',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/query`,
      { filters: { scope_key: scopeKey }, limit: cap },
      { retries: 1 },
    )
    const rows: any[] = result?.data || []
    const tasks = rows
      .map((r) => coerceTask(r, scopeKey))
      .filter((t): t is BuildTask => t !== null)
    return sortTasks(tasks).slice(0, cap)
  } catch (e) {
    console.warn('[task-store] listTasks failed:', (e as Error)?.name || e)
    return []
  }
}

/**
 * Update a task's stage and/or output by id within a scope. Best-effort: returns
 * true on success, false on any failure (never throws). Uses ZeroDB's row update
 * filtered by {scope_key, id} so a task is only mutated within its own company.
 */
export async function updateTask(
  scopeKey: string,
  id: string,
  patch: { stage?: string; output?: string; taskId?: string | null },
): Promise<boolean> {
  if (!scopeKey || !id) return false
  const row_data: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.stage != null) row_data.stage = normalizeStage(patch.stage)
  if (patch.output != null) row_data.output = String(patch.output).slice(0, 8000)
  if (patch.taskId !== undefined) row_data.task_id = patch.taskId
  // Nothing to change beyond the timestamp → treat as a no-op success.
  if (Object.keys(row_data).length === 1) return true
  try {
    const result = await zerodbRequest(
      'PUT',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/rows`,
      { filters: { scope_key: scopeKey, id }, row_data },
      { retries: 1 },
    )
    return !!result
  } catch (e) {
    console.warn('[task-store] updateTask failed:', (e as Error)?.name || e)
    return false
  }
}
