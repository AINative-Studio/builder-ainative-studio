/**
 * Option B — nightly autonomous loop cron (#207). Fires nightly (schedule via
 * the same cron mechanism as app/api/cron/alerts). Iterates enrolled companies
 * and runs one autonomous iteration each (brief → dispatch to agent swarm).
 * CRON_SECRET-secured, same pattern as the existing cron routes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { listEnrolled, recordRun } from '@/lib/build/loop-enrollment'
import { runNightlyLoop } from '@/lib/build/autonomous-loop'
import { chatScopeKey } from '@/lib/build/chat-store'
import { createDocument } from '@/lib/build/document-store'
import { buildDailyReport, dailyReportTitle } from '@/lib/build/document-prompts'
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
    for (const e of enrolled) {
      const r = await runNightlyLoop({
        companyId: e.companyId, companyName: e.companyName, track: e.track, goal: e.goal,
      })
      await recordRun(e.companyId, r.taskId, r.status)

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

      results.push(r)
    }

    const dispatched = results.filter((r) => r.status === 'dispatched').length
    logger.info('Nightly autonomous loop complete', { dispatched, total: results.length, reportsWritten })
    return NextResponse.json({ ok: true, enrolled: enrolled.length, dispatched, reportsWritten, results })
  } catch (error) {
    logger.error('Nightly autonomous loop failed', error as Error)
    return NextResponse.json({ error: 'Nightly loop failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
