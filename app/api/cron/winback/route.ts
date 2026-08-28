import { NextRequest, NextResponse } from 'next/server'
import { runWinbackSweep, unsubscribe } from '@/lib/growth/winback-email'
import { logger } from '@/lib/logger'

/**
 * Winback re-engagement sweep (#344). Scheduler-driven, secured with
 * `Authorization: Bearer $CRON_SECRET` (same pattern as /api/cron/alerts).
 *
 * SAFETY: defaults to DRY-RUN. A real send requires BOTH the secret AND an
 * explicit `?send=true` — so a routine cron ping (or a probe) never emails a
 * real user. The middleware allowlists /api/cron/* (#344 prereq); this handler
 * is the actual auth boundary.
 *
 * Unsubscribe (`GET ?unsubscribe=<email>`) is intentionally allowed WITHOUT the
 * secret — it's a link real users click from the email footer.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)

  // Unsubscribe link — no secret required (users click it from the email).
  const unsub = url.searchParams.get('unsubscribe')
  if (unsub) {
    await unsubscribe(unsub)
    return NextResponse.json({ ok: true, unsubscribed: unsub })
  }

  // Everything else is the cron sweep — secret-gated.
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    logger.warn('Unauthorized winback cron request', {
      path: '/api/cron/winback',
      ip: request.headers.get('x-forwarded-for') || 'unknown',
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Real send only with an explicit flag; otherwise dry-run (select + suppress,
  // send nothing, write no log).
  const send = url.searchParams.get('send') === 'true'
  const limitParam = url.searchParams.get('limit')
  const limit = limitParam ? Math.max(0, Number(limitParam) || 0) : undefined

  try {
    const result = await runWinbackSweep({ dryRun: !send, limit })
    logger.info('Winback sweep complete', {
      dryRun: result.dryRun,
      candidates: result.candidates,
      sent: result.sent,
      suppressed: result.suppressed,
      failed: result.failed,
    })
    return NextResponse.json(result)
  } catch (error) {
    logger.error('Winback sweep failed', error as Error)
    return NextResponse.json({ error: 'Winback sweep failed' }, { status: 500 })
  }
}
