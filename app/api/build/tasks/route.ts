/**
 * /api/build/tasks (#55) — the company's REAL Tasks/Backlog list with lifecycle
 * stages (To Do / Recurring / In Progress / Completed / Rejected / Failed).
 *
 * Replaces the hardcoded `tonight` array on the Live dashboard with a stateful,
 * per-company backlog persisted in ZeroDB (`build_tasks`), scoped per
 * {owner, company} exactly like the chat store (#52). The swarm dispatch
 * (/api/build/swarm) and the nightly loop create tasks here as REAL work is
 * dispatched, and update their stage as the platform reports status.
 *
 * AX (our moat, #55 req 6): this endpoint is the machine surface — a founder's
 * OWN agent can list and create tasks the same way the UI does, no scraping.
 *
 *   GET  ?companyId=…&stage=…    → { tasks: BuildTask[], counts, stages }
 *   POST { companyId, title, detail?, stage?, source? }  → { task }
 *   PATCH { companyId, id, stage?, output?, taskId? }     → { ok }
 *
 * The owner half of the scope is ALWAYS taken from the server session — never
 * trusted from the body — so one founder can't read/write another's backlog.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { deriveOwnerKey, chatScopeKey } from '@/lib/build/chat-store'
import {
  createTask,
  listTasks,
  updateTask,
  countByStage,
  filterByStage,
  isTaskStage,
  recurringTaskFromLoop,
  withRecurringTask,
  TASK_STAGES,
  STAGE_LABELS,
  type TaskSource,
} from '@/lib/build/task-store'
import { isEnrolled, getLastRun } from '@/lib/build/loop-enrollment'

export const runtime = 'nodejs'

/** Resolve the durable task scope key from the SERVER session + company slug. */
async function resolveScopeKey(companyId: string): Promise<string> {
  const slug = String(companyId || '').trim()
  if (!slug) return ''
  const session = await auth().catch(() => null)
  return chatScopeKey(deriveOwnerKey(session as any), slug)
}

/** The stage vocabulary + labels, so a client/agent can render tabs generically. */
const STAGE_META = TASK_STAGES.map((s) => ({ stage: s, label: STAGE_LABELS[s] }))

/**
 * GET — list the company's tasks (optionally filtered by ?stage=). Returns an
 * honest empty list for a brand-new company. Never 500s: on any failure it
 * yields an empty backlog so the dashboard still renders.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const companyId = String(params.get('companyId') || params.get('chatId') || '').slice(0, 80)
  const stage = params.get('stage')
  const scopeKey = await resolveScopeKey(companyId)
  if (!scopeKey) return Response.json({ tasks: [], counts: countByStage([]), stages: STAGE_META })

  // Persisted tasks + the synthetic "Recurring" task that reflects the REAL
  // nightly loop (#55 req 5). Both reads degrade to empty/false on failure.
  const [persisted, enrolled, lastRun] = await Promise.all([
    listTasks(scopeKey).catch(() => []),
    isEnrolled(companyId).catch(() => false),
    getLastRun(companyId).catch(() => null),
  ])
  const recurring = recurringTaskFromLoop(scopeKey, enrolled, lastRun)
  const all = withRecurringTask(persisted, recurring)
  const tasks = filterByStage(all, stage)
  return Response.json({ tasks, counts: countByStage(all), stages: STAGE_META })
}

/**
 * POST — create a task. `title` is required; `stage` defaults to 'todo'. The
 * source is normalized ('cody' unless a trusted caller sets 'swarm'/'recurring').
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const companyId = String(body?.companyId || body?.chatId || '').slice(0, 80)
  const title = String(body?.title || '').trim()
  if (!companyId) return Response.json({ error: 'companyId required' }, { status: 400 })
  if (!title) return Response.json({ error: 'title required' }, { status: 400 })

  const scopeKey = await resolveScopeKey(companyId)
  if (!scopeKey) return Response.json({ error: 'no scope' }, { status: 400 })

  const source: TaskSource | undefined =
    body?.source === 'swarm' || body?.source === 'recurring' || body?.source === 'cody'
      ? body.source
      : undefined

  const task = await createTask(scopeKey, {
    title,
    detail: body?.detail ? String(body.detail) : undefined,
    stage: body?.stage,
    source,
    taskId: body?.taskId ?? null,
  })
  if (!task) return Response.json({ error: 'could not create task' }, { status: 502 })
  return Response.json({ task })
}

/**
 * PATCH — update a task's stage / output / platform taskId by id. Used both by
 * the UI (e.g. reject a task) and by the swarm/nightly wiring as the platform
 * reports status transitions.
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const companyId = String(body?.companyId || body?.chatId || '').slice(0, 80)
  const id = String(body?.id || '').trim()
  if (!companyId || !id) return Response.json({ error: 'companyId and id required' }, { status: 400 })
  if (body?.stage != null && !isTaskStage(String(body.stage))) {
    return Response.json({ error: 'invalid stage' }, { status: 400 })
  }

  const scopeKey = await resolveScopeKey(companyId)
  if (!scopeKey) return Response.json({ error: 'no scope' }, { status: 400 })

  const ok = await updateTask(scopeKey, id, {
    stage: body?.stage,
    output: body?.output,
    taskId: body?.taskId,
  })
  if (!ok) return Response.json({ error: 'could not update task' }, { status: 502 })
  return Response.json({ ok: true })
}
