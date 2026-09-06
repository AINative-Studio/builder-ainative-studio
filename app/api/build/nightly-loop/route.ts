/**
 * Option B — nightly autonomous loop cron (#207). Fires nightly (schedule via
 * the same cron mechanism as app/api/cron/alerts). Iterates enrolled companies
 * and runs one autonomous iteration each (brief → dispatch to agent swarm).
 * CRON_SECRET-secured, same pattern as the existing cron routes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { listEnrolled, recordRun } from '@/lib/build/loop-enrollment'
import { runNightlyLoop } from '@/lib/build/autonomous-loop'
import { appendAutoRunEvent } from '@/lib/build/auto-mode'
import { dispatchEventTitle } from '@/lib/build/auto-run-activity'
import { chatScopeKey } from '@/lib/build/chat-store'
import { createDocument, hasReportForDate, pruneDuplicateReports } from '@/lib/build/document-store'
import { buildDailyReport, dailyReportTitle } from '@/lib/build/document-prompts'
import { runMediaRoutines } from '@/lib/build/media-routine'
import { runTaskResolutions } from '@/lib/build/task-resolution-loop'
import { resolveApp } from '@/lib/build/app-registry'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const enrolled = await listEnrolled()
    logger.info('Nightly autonomous loop starting', { count: enrolled.length })

    const results = []
    let reportsWritten = 0
    let mediaGenerated = 0
    let tasksAttempted = 0
    let tasksCompleted = 0
    for (const e of enrolled) {
      const r = await runNightlyLoop({
        companyId: e.companyId, companyName: e.companyName, track: e.track, goal: e.goal,
      })
      await recordRun(e.companyId, r.taskId, r.status)

      // Event trail (#340): when an Auto Mode run is ACTIVE for this company,
      // append this dispatch to its recentEvents ring so the founder's Live
      // dashboard shows the run's real activity. No-op for plain nightly
      // enrollments (appendAutoRunEvent only writes to an active run).
      if (r.status !== 'skipped') {
        await appendAutoRunEvent(e.companyId, {
          ts: new Date().toISOString(),
          title: dispatchEventTitle({ track: e.track, taskId: r.taskId }),
          status: r.status === 'dispatched' ? 'dispatched' : 'failed',
        }).catch(() => {})
      }

      // Append a dated daily operational report to the company's Documents library
      // (#64 req 4). Grounded ENTIRELY in this run's REAL result (task id, status,
      // briefing, detail) — never fabricated. Best-effort: a persistence hiccup
      // must not break the loop. Keyed to the same {owner, company} scope the
      // Documents panel reads (falls back to companyId-only for pre-#64 enrollments).
      //
      // IDEMPOTENCY (real bug: "Daily Operational Report — Sep 5, 2026" appeared
      // 10x): the primary fix is deduping the enrollment list itself so a company
      // is iterated once per run (loop-enrollment.ts `dedupeByCompany`), but this
      // is a second, independent layer — skip the write entirely if a 'daily'
      // report already exists for THIS scope on today's calendar date, so a
      // duplicate dispatch (a manual workflow_dispatch re-run, a future caller
      // that re-triggers this route same-day) still can't double-write.
      if (e.ownerKey) {
        try {
          const runAt = new Date().toISOString()
          const scopeKey = chatScopeKey(e.ownerKey, e.companyId)
          const alreadyReported = await hasReportForDate(scopeKey, 'daily', runAt)
          if (!alreadyReported) {
            const input = {
              companyName: e.companyName,
              runAt,
              taskId: r.taskId,
              status: r.status,
              briefing: r.briefing,
              detail: r.detail,
            }
            const doc = await createDocument(scopeKey, {
              title: dailyReportTitle(input),
              content: buildDailyReport(input),
              type: 'daily',
            })
            if (doc) reportsWritten += 1
          }
          // Self-healing cleanup (real bug: 20 duplicate reports landed in one
          // scope for a single company BEFORE hasReportForDate existed, and
          // nothing ever retroactively collapsed them — the write-time guard
          // only stops NEW duplicates). Runs every pass, alongside the guard
          // above, so any stray duplicate (this backlog, or a future one from
          // a cause not yet found) self-heals on the very next nightly tick
          // instead of silently accumulating forever. Best-effort: never
          // blocks the loop.
          await pruneDuplicateReports(scopeKey).catch(() => {})
        } catch (err) {
          logger.warn('Daily report append failed', { companyId: e.companyId, err: (err as Error)?.message })
        }
      }

      // Media routine (#54): alongside the swarm dispatch, run any DUE on-brand
      // media routines for this company and persist the assets to its own storage.
      // Best-effort + fully gated: inert (no-op) when media generation isn't
      // configured, and a hiccup here must never break the nightly loop.
      //
      // BRAND GROUNDING (real bug — off-brand auto-generated images): this used to
      // pass ONLY companyName, so buildBrandPrompt() had no tagline, no brand
      // color, and — most importantly — no idea/business-description at all for
      // every auto-fired (Once/Daily/Weekly/Monthly) media routine, which is
      // exactly what produced a generic, ungrounded stock-photo image for a real
      // company ("Beacon"). What IS durably persisted and was being silently
      // dropped is the registry entry's tagline + brand color (set at
      // registration / brand step) — resolving it here grounds the recurring
      // prompt in the founder's real brand tagline and color instead of a bare
      // company name every time.
      //
      // REMAINING GAP (flagged honestly, not worked around): the company's real
      // `idea` text is only ever held in front-end React state (Live.tsx
      // `state.idea`) and is never persisted server-side against the company's
      // slug/registry entry — so a nightly, server-only cron genuinely has no
      // durable source to read it from. `LoopEnrollment.goal` looked like a
      // plausible substitute but is NOT: Live.tsx wires it as
      // `goal: state.answers?.privacy` (a leftover from an unrelated onboarding
      // question, not the idea) — using it here would inject wrong/misleading
      // content into the prompt, worse than leaving it empty. Passing real idea
      // grounding through to the nightly loop needs a real fix (persist `idea` on
      // the app registry at registration time) — out of scope for this prompt-
      // leak fix; tracked as a follow-up rather than silently faked here.
      if (e.ownerKey) {
        try {
          const scopeKey = chatScopeKey(e.ownerKey, e.companyId)
          const app = await resolveApp(e.companyId).catch(() => null)
          const m = await runMediaRoutines(scopeKey, {
            companyName: e.companyName,
            tagline: app?.tagline,
            color: app?.color,
          })
          mediaGenerated += m.generated
        } catch (err) {
          logger.warn('Media routine run failed', { companyId: e.companyId, err: (err as Error)?.message })
        }

        // Task resolution (#433, epic #371): resolveTask() had zero real
        // callers anywhere in the app until this — alongside the media
        // routine and swarm dispatch, resolve any DUE (`todo`) backlog tasks
        // for this company via the real coverage-gated pipeline. Best-effort
        // + fully bounded (MAX_TASKS_PER_COMPANY_PER_RUN): a hiccup here must
        // never break the nightly loop, and one company's backlog must never
        // starve the shared route's maxDuration budget.
        try {
          const scopeKey = chatScopeKey(e.ownerKey, e.companyId)
          const t = await runTaskResolutions(scopeKey, e.companyId)
          tasksAttempted += t.attempted
          tasksCompleted += t.completed
        } catch (err) {
          logger.warn('Task resolution run failed', { companyId: e.companyId, err: (err as Error)?.message })
        }
      }

      results.push(r)
    }

    const dispatched = results.filter((r) => r.status === 'dispatched').length
    logger.info('Nightly autonomous loop complete', { dispatched, total: results.length, reportsWritten, mediaGenerated, tasksAttempted, tasksCompleted })
    return NextResponse.json({ ok: true, enrolled: enrolled.length, dispatched, reportsWritten, mediaGenerated, tasksAttempted, tasksCompleted, results })
  } catch (error) {
    logger.error('Nightly autonomous loop failed', error as Error)
    return NextResponse.json({ error: 'Nightly loop failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
