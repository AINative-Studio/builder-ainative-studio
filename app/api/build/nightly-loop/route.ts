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
import { createDocument } from '@/lib/build/document-store'
import { buildDailyReport, dailyReportTitle } from '@/lib/build/document-prompts'
import { runMediaRoutines } from '@/lib/build/media-routine'
import { runTaskResolutions } from '@/lib/build/task-resolution-loop'
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
      if (e.ownerKey) {
        try {
          const runAt = new Date().toISOString()
          const input = {
            companyName: e.companyName,
            runAt,
            taskId: r.taskId,
            status: r.status,
            briefing: r.briefing,
            detail: r.detail,
          }
          const scopeKey = chatScopeKey(e.ownerKey, e.companyId)
          const doc = await createDocument(scopeKey, {
            title: dailyReportTitle(input),
            content: buildDailyReport(input),
            type: 'daily',
          })
          if (doc) reportsWritten += 1
        } catch (err) {
          logger.warn('Daily report append failed', { companyId: e.companyId, err: (err as Error)?.message })
        }
      }

      // Media routine (#54): alongside the swarm dispatch, run any DUE on-brand
      // media routines for this company and persist the assets to its own storage.
      // Best-effort + fully gated: inert (no-op) when media generation isn't
      // configured, and a hiccup here must never break the nightly loop.
      if (e.ownerKey) {
        try {
          const scopeKey = chatScopeKey(e.ownerKey, e.companyId)
          const m = await runMediaRoutines(scopeKey, { companyName: e.companyName })
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
