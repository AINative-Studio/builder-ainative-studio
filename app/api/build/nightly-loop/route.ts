/**
 * Option B — nightly autonomous loop cron (#207). Fires nightly (schedule via
 * the same cron mechanism as app/api/cron/alerts). Iterates enrolled companies
 * and runs one autonomous iteration each (brief → dispatch to agent swarm).
 * CRON_SECRET-secured, same pattern as the existing cron routes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { listEnrolled, recordRun } from '@/lib/build/loop-enrollment'
import { runNightlyLoop } from '@/lib/build/autonomous-loop'
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
    for (const e of enrolled) {
      const r = await runNightlyLoop({
        companyId: e.companyId, companyName: e.companyName, track: e.track, goal: e.goal,
      })
      await recordRun(e.companyId, r.taskId, r.status)
      results.push(r)
    }

    const dispatched = results.filter((r) => r.status === 'dispatched').length
    logger.info('Nightly autonomous loop complete', { dispatched, total: results.length })
    return NextResponse.json({ ok: true, enrolled: enrolled.length, dispatched, results })
  } catch (error) {
    logger.error('Nightly autonomous loop failed', error as Error)
    return NextResponse.json({ error: 'Nightly loop failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
