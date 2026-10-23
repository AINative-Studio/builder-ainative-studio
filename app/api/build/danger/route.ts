/**
 * POST /api/build/danger (#57, Danger Zone) — pause the company (stop the nightly
 * loop), take its app offline, or delete it, with a server-side confirmation
 * guard. Maps to the real state stores (loop-enrollment + app-registry lifecycle).
 *
 * Auth: a real (non-guest) session is required — Danger Zone acts on a persisted
 * company that only a real account owns (respects #50). Destructive actions
 * (offline, delete) additionally require a typed `confirm` matching the company
 * name/slug (enforced in parseDangerRequest) so a stray request can't nuke a company.
 *
 * OWNERSHIP CHECK (#649, real gap found live): the confirm-matches-name guard
 * only stops an ACCIDENTAL request — the company's name/slug is often publicly
 * visible (the /build/{slug} preview page, e.g.), so it was never a real
 * authorization boundary. Any signed-in (non-guest) founder could delete or
 * take offline a DIFFERENT founder's company just by knowing/guessing its name.
 * Now requires the registry entry's own recorded `ownerEmail` to match the
 * caller's session email before ANY action (pause/resume/offline/delete) is
 * applied — an entry with no owner recorded (never claimed) is rejected too,
 * not treated as fair game.
 *
 * Body: { action: 'pause'|'resume'|'offline'|'delete', companyId, companyName,
 *         track, slug?, confirm? }
 * Returns: { ok, action, loopChanged?, lifecycleChanged? } | { error }
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { parseDangerRequest, applyDangerAction } from '@/lib/build/danger-zone'
import { resolveAppVerified } from '@/lib/build/app-registry'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const session = await auth().catch(() => null)
  const type = (session as any)?.user?.type as string | undefined
  const email = ((session as any)?.user?.email as string | undefined)?.trim().toLowerCase()
  if (!email || type === 'guest') {
    return Response.json({ error: 'not_signed_in' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = parseDangerRequest(body)
  if (!parsed.ok || !parsed.value) {
    return Response.json({ error: parsed.error || 'invalid request' }, { status: 400 })
  }

  // #832-class fix: resolveApp()'s plain `null` collapses "no such company" /
  // "never claimed" with "the registry read itself failed" — a transient
  // ZeroDB hiccup used to bounce the REAL owner off a pause/offline/delete
  // action with a flat 403 "not_owner", on their own company, same as #1327
  // already fixed for backlog/versions. resolveAppVerified() tells the two
  // apart so a hiccup gets an honest, retryable answer instead of a false
  // ownership denial on a destructive endpoint.
  const { entry, verified } = await resolveAppVerified(parsed.value.slug).catch(() => ({ entry: null, verified: false }))
  if (!verified) {
    logger.info('danger-zone action deferred — could not verify ownership', {
      action: parsed.value.action,
      companyId: parsed.value.companyId,
    })
    return Response.json({ error: 'unverified', message: 'Could not verify ownership right now — try again in a moment.' }, { status: 503 })
  }
  const ownerEmail = entry?.ownerEmail?.trim().toLowerCase()
  if (!ownerEmail || ownerEmail !== email) {
    logger.info('danger-zone action rejected — not the owner', {
      action: parsed.value.action,
      companyId: parsed.value.companyId,
    })
    return Response.json({ error: 'not_owner' }, { status: 403 })
  }

  try {
    const outcome = await applyDangerAction(parsed.value, (session as any)?.accessToken)
    logger.info('danger-zone action applied', {
      action: parsed.value.action,
      companyId: parsed.value.companyId,
    })
    return Response.json(outcome)
  } catch (e) {
    logger.error('danger-zone action failed', e as Error)
    return Response.json({ error: 'action failed' }, { status: 502 })
  }
}
