/**
 * Server-side registration reconciliation cron (#1015) — the safety net behind
 * the browser-only register-app trigger. See lib/build/registration-reconcile.ts
 * for the full rationale, the live "Flo" evidence, and the safety contract.
 *
 * SAFETY: mirrors app/api/cron/loop-backfill and app/api/cron/comms-digest — a
 * real sweep requires BOTH the CRON_SECRET *and* an explicit `?send=true`, so a
 * routine cron ping, a health probe, or a mistaken curl can only ever perform a
 * dry run. That matters here because a real run pushes git commits into real
 * customer repositories.
 *
 * `?slug=` reconciles exactly one company instead of enumerating the registry —
 * the shape a per-company touchpoint (a dashboard load, a support repair)
 * should use so a single founder's page view never sweeps the platform.
 *
 *   Dry run:      GET /api/cron/reconcile-registration                    (Bearer $CRON_SECRET)
 *   Real run:     GET /api/cron/reconcile-registration?send=true          (Bearer $CRON_SECRET)
 *   One company:  GET /api/cron/reconcile-registration?send=true&slug=flo (Bearer $CRON_SECRET)
 *
 * It lives under /api/cron/* to inherit that path's established secret-gating
 * (middleware.ts allowlists the prefix; this handler is the auth boundary).
 */

import { NextRequest, NextResponse } from 'next/server'
import { runRegistrationReconcileSweep } from '@/lib/build/registration-reconcile'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    logger.warn('Unauthorized reconcile-registration cron request', {
      path: '/api/cron/reconcile-registration',
      ip: request.headers.get('x-forwarded-for') || 'unknown',
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = new URL(request.url).searchParams
  const send = params.get('send') === 'true'
  const slug = params.get('slug')?.trim() || undefined

  try {
    const result = await runRegistrationReconcileSweep({ dryRun: !send, slug })

    // A failed registry read is reported as a real problem, never as a clean
    // "0 reconciled" success (core#7395 — an outage must not look like an empty
    // platform, which here would mean "no company is stuck").
    if (!result.registryOk) {
      return NextResponse.json(
        { ...result, error: 'registry read failed — sweep did not run' },
        { status: 503 },
      )
    }

    logger.info('Registration reconciliation sweep complete', {
      dryRun: result.dryRun, slug: slug || null, total: result.total,
      candidates: result.candidates, reconciled: result.reconciled,
      committed: result.committed, skipped: result.skipped,
      byDisposition: result.byDisposition,
    })
    return NextResponse.json(result)
  } catch (error) {
    logger.error('Registration reconciliation sweep failed', error as Error)
    return NextResponse.json({ error: 'Registration reconciliation sweep failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
