/**
 * /api/build/auto-mode (#58) — user-set autonomous run duration ("works nonstop,
 * you choose how long"). The machine surface for the AutoModePanel on Live AND for
 * a founder's own agent (AX, #58 req 4 — start/stop via endpoint).
 *
 * A user-initiated BOUNDED run: the founder picks a window (1h/4h/8h/overnight/
 * continuous) and STARTS. We (1) enroll the company in the SAME loop the nightly
 * cron drives (builder_loop_enrollments), tagged with the duration + expiry, so
 * the existing cron keeps dispatching the swarm across the window; (2) fire ONE
 * immediate real swarm dispatch (runNightlyLoop) so the run starts working now;
 * and (3) persist an 'auto' run row the panel polls for live progress.
 *
 *   GET  ?companyId=…                                   → { configured, gated, run, progress, cost, durations }
 *   POST { companyId, companyName?, duration, action:'start' } → { ok, run, progress, cost } | { ok:false, reason }
 *   POST { companyId, action:'stop' }                   → { ok }
 *
 * GATING (#58 req 5): the bounded run is a paid capability — gated on the SAME
 * `nightlyLoop` unlock (Business+) the nightly enrollment uses. Credit COST is
 * quoted transparently (Polsia-style) but not hard-charged here (no live credit
 * ledger yet) — the founder always sees the cost before starting.
 *
 * SAFETY (#58 req 5): inert when the run store / loop isn't configured. Start then
 * returns { ok:false, reason:'unavailable' } and never 500s — a missing key can
 * never break build or runtime.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { deriveOwnerKey } from '@/lib/build/chat-store'
import {
  AUTO_DURATIONS,
  DURATION_LABELS,
  normalizeDuration,
  creditCostLabel,
  estimateCreditCost,
  runProgress,
  autoModeConfigured,
  startAutoRun,
  stopAutoRun,
  getAutoRun,
  type AutoDuration,
} from '@/lib/build/auto-mode'
import { enrollCompany, setLoopEnabled } from '@/lib/build/loop-enrollment'
import { runNightlyLoop } from '@/lib/build/autonomous-loop'
import { planUnlocks } from '@/lib/build/state'
import { resolveActivePlan } from '@/lib/ainative/active-plan'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** The duration catalog surfaced to the client + agents (id, label, cost line). */
function durationCatalog() {
  return AUTO_DURATIONS.map((d) => ({
    id: d,
    label: DURATION_LABELS[d],
    cost: creditCostLabel(d),
    credits: estimateCreditCost(d),
  }))
}

/** Owner key from the SERVER session — never trusted from the request body. */
async function ownerKeyFromSession(): Promise<string> {
  const session = await auth().catch(() => null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return deriveOwnerKey(session as any)
}

/**
 * Resolve whether Auto Mode is unlocked for this caller — SERVER-side, from the
 * session → core /auth/me (resolveActivePlan). The old check gated on
 * `body.plan`, which the panel never sent, so EVERY founder — including
 * Enterprise/admin — got `not_paid` and was bounced to pricing. The client body
 * is never consulted for entitlement.
 */
async function isGated(): Promise<boolean> {
  const { plan } = await resolveActivePlan()
  return !planUnlocks(plan).nightlyLoop
}

/** GET — current run + live progress + cost catalog. Never 500s. */
export async function GET(request: NextRequest) {
  const companyId = String(request.nextUrl.searchParams.get('companyId') || '').slice(0, 80)
  const configured = autoModeConfigured()
  const base = { configured, durations: durationCatalog() }
  if (!companyId || !configured) {
    return Response.json({ ...base, run: null, progress: runProgress(null, Date.now()) })
  }
  try {
    const run = await getAutoRun(companyId)
    return Response.json({ ...base, run, progress: runProgress(run, Date.now()) })
  } catch (err) {
    logger.warn('auto-mode GET failed', { companyId, err: (err as Error)?.message })
    return Response.json({ ...base, run: null, progress: runProgress(null, Date.now()) })
  }
}

/** POST — start or stop a bounded Auto Mode run. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const companyId = String(body.companyId || '').trim().slice(0, 80)
  const action = String(body.action || 'start')
  if (!companyId) {
    return Response.json({ ok: false, reason: 'companyId required' }, { status: 400 })
  }
  if (!autoModeConfigured()) {
    // Inert + honest — never 500. The panel renders the disabled state.
    return Response.json({ ok: false, reason: 'unavailable' }, { status: 200 })
  }

  const ownerKey = await ownerKeyFromSession()

  // ---- STOP -------------------------------------------------------------
  if (action === 'stop') {
    try {
      const ok = await stopAutoRun({ companyId, ownerKey })
      // Also pause the loop enrollment so the cron stops dispatching for this run.
      const companyName = String(body.companyName || companyId)
      const track = (body.track === 'app' ? 'app' : 'company') as 'app' | 'company'
      await setLoopEnabled(companyId, companyName, track, false).catch(() => {})
      const run = await getAutoRun(companyId)
      return Response.json({ ok, run, progress: runProgress(run, Date.now()) })
    } catch (err) {
      logger.warn('auto-mode stop failed', { companyId, err: (err as Error)?.message })
      return Response.json({ ok: false, reason: 'stop failed' }, { status: 200 })
    }
  }

  // ---- START ------------------------------------------------------------
  // Plan gate (#58 req 5): bounded auto-run is Business+ (same unlock as nightly),
  // resolved SERVER-side from the session — never from the request body.
  if (await isGated()) {
    return Response.json({ ok: false, reason: 'not_paid' }, { status: 200 })
  }

  const duration: AutoDuration = normalizeDuration(body.duration)
  const companyName = String(body.companyName || companyId)
  const track = (body.track === 'app' ? 'app' : 'company') as 'app' | 'company'

  try {
    // 1. Persist the bounded run (start row) — the panel polls this for progress.
    const run = await startAutoRun({ companyId, companyName, duration, ownerKey })
    if (!run) {
      return Response.json({ ok: false, reason: 'unavailable' }, { status: 200 })
    }

    // 2. Enroll in the SAME loop the nightly cron drives, tagged with the window,
    //    so the swarm keeps being dispatched across the bounded duration. Additive:
    //    the enrollment carries autoDuration + autoExpiresAt (see loop-enrollment).
    await enrollCompany({
      companyId,
      companyName,
      track,
      ownerKey,
      autoDuration: duration,
      autoExpiresAt: run.expiresAt,
    }).catch(() => {})

    // 3. Fire ONE immediate real dispatch so the run starts working NOW rather than
    //    waiting for the next cron tick. Best-effort — a dispatch hiccup must not
    //    fail the start (the enrollment + cron will still drive the window).
    let firstTaskId: string | null = null
    try {
      const r = await runNightlyLoop({ companyId, companyName, track })
      firstTaskId = r.taskId
    } catch (err) {
      logger.warn('auto-mode first dispatch failed', { companyId, err: (err as Error)?.message })
    }

    logger.info('Auto Mode started', { companyId, autoDuration: duration, expiresAt: run.expiresAt, firstTaskId })
    return Response.json({
      ok: true,
      run,
      progress: runProgress(run, Date.now()),
      cost: creditCostLabel(duration),
      firstTaskId,
    })
  } catch (err) {
    logger.error('auto-mode start failed', err as Error)
    return Response.json({ ok: false, reason: 'start failed' }, { status: 200 })
  }
}
