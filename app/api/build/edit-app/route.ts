/**
 * POST /api/build/edit-app (#582) — the first real "edit an already-deployed
 * company's app code from live chat" capability.
 *
 * Real gap (found live, WhatsApp bug report, product "dedux"): once a company
 * is deployed, chat-ws only ever runs a fresh full-generation pipeline — there
 * was no code path anywhere that edited EXISTING generated-app code from a
 * conversational request. A founder asking "please change X" in the Live
 * dashboard's chat got a scripted "I'll wire that next" reply that never
 * actually did anything.
 *
 * Deliberately reuses the EXACT SAME pipeline the nightly backlog-resolution
 * loop already uses (lib/build/task-resolver.ts's resolveTask: implement →
 * commit+PR → coverage-gated verify → auto-merge/redeploy) rather than
 * building a second, parallel implementation with different safety
 * properties. A chat-triggered edit becomes a REAL BuildTask row (source:
 * 'cody'), so it's visible in the founder's own Tasks panel exactly like any
 * other backlog item, and gets the identical coverage gate before it ever
 * touches the live app.
 *
 * Requires the company to be git-provisioned (resolveTask's own hard
 * requirement) — an honest, specific failure reason is returned otherwise
 * rather than a generic error, so the caller (ask/route.ts) can give the
 * founder real information instead of a fabricated "done."
 *
 * Body: { companyId, request } — `request` is the founder's edit request text.
 * Returns: { ok, stage, reason?, prUrl?, merged?, redeployed?, coveragePercent? }
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { deriveOwnerKey, chatScopeKey } from '@/lib/build/chat-store'
import { resolveApp } from '@/lib/build/app-registry'
import { createTask } from '@/lib/build/task-store'
import { resolveTask } from '@/lib/build/task-resolver'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  const companyId = String(b?.companyId || '').trim().slice(0, 80)
  const editRequest = String(b?.request || '').trim().slice(0, 2000)
  if (!companyId || !editRequest) {
    return Response.json({ ok: false, reason: 'companyId and request are required' }, { status: 400 })
  }

  const app = await resolveApp(companyId).catch(() => null)
  if (!app?.gitOrg) {
    return Response.json(
      { ok: false, stage: 'failed', reason: 'This company is not git-provisioned yet, so there is no repo to edit. It needs a paid plan first.' },
      { status: 200 },
    )
  }

  const session = await auth().catch(() => null)
  const scopeKey = chatScopeKey(deriveOwnerKey(session as any), companyId)

  const task = await createTask(scopeKey, {
    title: editRequest.slice(0, 400),
    detail: `Live-chat edit request: "${editRequest}"`,
    stage: 'todo',
    source: 'cody',
  })
  if (!task) {
    return Response.json(
      { ok: false, stage: 'failed', reason: 'Could not create a tracked task for this edit — please try again.' },
      { status: 200 },
    )
  }

  const result = await resolveTask(scopeKey, task, companyId)
  return Response.json(result)
}
