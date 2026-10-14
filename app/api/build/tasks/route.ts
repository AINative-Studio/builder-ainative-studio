/**
 * /api/build/tasks (#55) — the company's REAL Tasks/Backlog list with lifecycle
 * stages (To Do / Recurring / In Progress / Completed / Rejected / Failed).
 *
 * Replaces the hardcoded `tonight` array on the Live dashboard with a stateful,
 * per-company backlog persisted in ZeroDB (`build_tasks`). The swarm dispatch
 * (/api/build/swarm) and the nightly loop create tasks here as REAL work is
 * dispatched, and update their stage as the platform reports status; the
 * Gitea webhook (#1086, lib/git/task-sync-from-git.ts) keeps a task's stage
 * honest against its real PR outcome (merged/rejected/CI-failed).
 *
 * AX (our moat, #55 req 6): this endpoint is the machine surface — a founder's
 * OWN agent can list and create tasks the same way the UI does, no scraping.
 *
 *   GET  ?companyId=…&stage=…    → { tasks: BuildTask[], counts, stages }
 *   POST { companyId, title, detail?, stage?, source? }  → { task }
 *   PATCH { companyId, id, stage?, output?, taskId? }     → { ok }
 *
 * SCOPING (#1086 req 4 — real bug fixed here): GET is now COMPANY-scoped, not
 * gated by which owner session originally created each task. The original
 * design scoped every read/write by `{ownerKey}::{companySlug}` (identical to
 * the chat store, #52) — fine for a single-founder solo session, but it meant
 * a second authorized session viewing the SAME company (a teammate, or the
 * Gitea webhook's own synthetic rows written under a sentinel owner key, see
 * task-sync-from-git.ts) saw a stale/empty backlog, because `listTasks` only
 * ever queried ONE exact scope key. `listTasksForCompany` (task-store.ts)
 * fixes the read path by aggregating every owner's rows for a company.
 *
 * POST/PATCH deliberately KEEP owner-scoped writes — the swarm/nightly-loop/
 * resolver/splitter pipeline (lib/build/task-resolver.ts, task-splitter.ts,
 * app/api/build/swarm/route.ts, app/api/build/nightly-loop/route.ts) all
 * already compute and persist `{ownerKey}::{companySlug}` as a task's
 * `scope_key`, and changing the STORAGE shape would require migrating every
 * one of those write paths together — out of scope for a dashboard-visibility
 * fix. Reading company-wide while writing owner-scoped is safe precisely
 * because `scope_key` always ends in `::{companySlug}` (chatScopeKey's own
 * join), so `scopeKeyBelongsToCompany` recognizes every owner's row
 * regardless of which owner wrote it — there's no second parallel scoping
 * model, just a wider READ over the same rows.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { deriveOwnerKey, chatScopeKey } from '@/lib/build/chat-store'
import {
  createTask,
  listTasksForCompany,
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

/** Resolve the durable task scope key from the SERVER session + company slug.
 *  Used by POST/PATCH (writes stay owner-scoped — see module doc above). */
async function resolveScopeKey(companyId: string): Promise<string> {
  const slug = String(companyId || '').trim()
  if (!slug) return ''
  const session = await auth().catch(() => null)
  return chatScopeKey(deriveOwnerKey(session as any), slug)
}

/** The stage vocabulary + labels, so a client/agent can render tabs generically. */
const STAGE_META = TASK_STAGES.map((s) => ({ stage: s, label: STAGE_LABELS[s] }))

/**
 * GET — list the company's tasks (optionally filtered by ?stage=), company-
 * wide across every owner (#1086 — see module doc). Returns an honest empty
 * list for a brand-new company. Never 500s: on any failure it yields an
 * empty backlog so the dashboard still renders.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const companyId = String(params.get('companyId') || params.get('chatId') || '').slice(0, 80)
  const stage = params.get('stage')
  const slug = companyId.trim()
  if (!slug) return Response.json({ tasks: [], counts: countByStage([]), stages: STAGE_META })

  // Persisted tasks (company-wide, #1086) + the synthetic "Recurring" task
  // that reflects the REAL nightly loop (#55 req 5). Both reads degrade to
  // empty/false on failure.
  const [persisted, enrolled, lastRun] = await Promise.all([
    listTasksForCompany(slug).catch(() => []),
    isEnrolled(companyId).catch(() => false),
    getLastRun(companyId).catch(() => null),
  ])
  const recurring = recurringTaskFromLoop(slug, enrolled, lastRun)
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
 *
 * #1086: GET now surfaces every owner's tasks for a company (incl. the Gitea
 * webhook's synthetic rows, written under their own sentinel scope key — see
 * task-sync-from-git.ts), so a PATCH by id can no longer assume the row lives
 * under the VIEWING session's own `{owner}::{company}` scope key — it might
 * belong to a teammate's session, or to no real founder session at all. Look
 * the row up company-wide first to find its REAL persisted scopeKey, then
 * write there; this still only mutates a row that genuinely belongs to this
 * company (never cross-company), it just no longer requires the row to have
 * been created by the exact session doing the PATCH.
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const companyId = String(body?.companyId || body?.chatId || '').slice(0, 80)
  const id = String(body?.id || '').trim()
  if (!companyId || !id) return Response.json({ error: 'companyId and id required' }, { status: 400 })
  if (body?.stage != null && !isTaskStage(String(body.stage))) {
    return Response.json({ error: 'invalid stage' }, { status: 400 })
  }

  const companyTasks = await listTasksForCompany(companyId).catch(() => [])
  const target = companyTasks.find((t) => t.id === id)
  // Fall back to the viewer's own scope key for a task that hasn't made it
  // into a company-wide read yet (e.g. a same-request race right after
  // creation) — matches the pre-#1086 behavior for that edge case rather
  // than failing a PATCH that immediately follows a POST.
  const scopeKey = target?.scopeKey || (await resolveScopeKey(companyId))
  if (!scopeKey) return Response.json({ error: 'no scope' }, { status: 400 })

  const ok = await updateTask(scopeKey, id, {
    stage: body?.stage,
    output: body?.output,
    taskId: body?.taskId,
  })
  if (!ok) return Response.json({ error: 'could not update task' }, { status: 502 })
  return Response.json({ ok: true })
}
