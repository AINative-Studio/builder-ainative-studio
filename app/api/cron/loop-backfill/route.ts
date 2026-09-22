/**
 * Paid-but-never-enrolled backfill cron (#841) — the retroactive counterpart to
 * #826's forward-only fix. See lib/build/loop-backfill.ts for the full rationale
 * and the safety contract.
 *
 * SAFETY: mirrors app/api/cron/comms-digest and app/api/cron/winback — a real
 * sweep requires BOTH the CRON_SECRET *and* an explicit `?send=true`, so a
 * routine cron ping, a health probe, or a mistaken curl can only ever perform a
 * dry run. This matters more here than for an email digest: a real run enrolls
 * live customer companies and fires billable swarm dispatches.
 *
 * Deliberately NOT wired to a schedule. Unlike the other crons this is a
 * one-shot repair for a known, bounded backlog, not a recurring job — it is
 * invoked manually, reviewed, and only then run for real. It lives under
 * /api/cron/* purely to inherit that path's established secret-gating (the
 * middleware allowlists the prefix; this handler is the auth boundary).
 *
 *   Dry run:  GET /api/cron/loop-backfill              (Bearer $CRON_SECRET)
 *   Real run: GET /api/cron/loop-backfill?send=true    (Bearer $CRON_SECRET)
 */

import { NextRequest, NextResponse } from 'next/server'
import { runLoopBackfillSweep } from '@/lib/build/loop-backfill'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    logger.warn('Unauthorized loop-backfill cron request', {
      path: '/api/cron/loop-backfill',
      ip: request.headers.get('x-forwarded-for') || 'unknown',
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const send = new URL(request.url).searchParams.get('send') === 'true'

  try {
    const result = await runLoopBackfillSweep({ dryRun: !send })
    // A failed registry read is reported as a real problem, never as a clean
    // "0 enrolled" success (core#7395 — an outage must not look like an
    // empty platform).
    if (!result.registryOk) {
      return NextResponse.json(
        { ...result, error: 'registry read failed — sweep did not run' },
        { status: 503 },
      )
    }
    logger.info('Loop backfill sweep complete', {
      dryRun: result.dryRun, total: result.total, candidates: result.candidates,
      enrolled: result.enrolled, dispatched: result.dispatched,
      skipped: result.skipped, failed: result.failed,
    })
    return NextResponse.json(result)
  } catch (error) {
    logger.error('Loop backfill sweep failed', error as Error)
    return NextResponse.json({ error: 'Loop backfill sweep failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
