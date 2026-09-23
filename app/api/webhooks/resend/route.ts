/**
 * POST /api/webhooks/resend (#840) — the real, structural fix for the
 * silent-bounce gap: Resend returns a clean 2xx for a suppressed/hard-
 * bounced recipient at send time, then drops the email asynchronously,
 * server-side. Before this route existed, that failure was completely
 * invisible to this codebase — confirmed via search, no Resend webhook
 * handler existed anywhere, so `sent: true` for a since-bounced recipient
 * was silently WRONG in every summary (the digest cron's own, and every
 * caller of sendCompanyEmail/sendWelcomeEmail). Real, live evidence: 28
 * daily-digest sends to admin@ainative.studio (an Enterprise account owning
 * ~30 companies) all reported `sent: true` while Resend's own `GET /emails`
 * showed `last_event: "suppressed"` for every one — zero real emails were
 * ever delivered, with nothing anywhere in Builder surfacing that fact.
 *
 * Handles, at minimum, the two events the issue calls out:
 *   - `email.bounced`  — a PERMANENT bounce (data.bounce.type === 'Permanent')
 *     is the durable signal Resend itself uses for suppression-list entries;
 *     a transient/soft bounce (type !== 'Permanent', e.g. a temporary mailbox-
 *     full condition) is NOT treated as a durable "give up" signal — that
 *     would incorrectly permanently silence a recipient over a one-time
 *     transient issue. This mirrors Resend's OWN suppression-list logic
 *     (their dashboard docs describe permanent bounces, specifically, as
 *     what populates the suppression list — a temporary bounce does not).
 *   - `email.complained` — a spam complaint is ALWAYS treated as a durable
 *     "stop sending" signal (no soft/hard distinction exists for complaints
 *     — a single complaint is Resend's own trigger for suppression).
 * Every other event type (delivered/opened/clicked/sent/etc.) is accepted
 * with 200 OK and a no-op — Resend expects a 2xx for every event type it
 * sends to an endpoint, even ones the endpoint doesn't act on, or it will
 * keep retrying redelivery indefinitely.
 *
 * SIGNATURE VERIFICATION: Resend signs every webhook delivery via Svix
 * (confirmed against Resend's own current docs — see
 * lib/build/resend-webhook-verify.ts's doc comment for the full research).
 * Verified over the RAW request body bytes (never a re-serialized parse —
 * same discipline as ad-budget-confirmed's own webhook, since Svix's HMAC is
 * exactly as sensitive to re-serialization drift as that route's own scheme).
 *
 * Configure in Resend's dashboard (Webhooks → Add Endpoint):
 *   URL: https://builder.ainative.studio/api/webhooks/resend
 *   Events: email.bounced, email.complained (email.delivered/opened/clicked
 *     optional — accepted as no-ops either way)
 *   Signing secret: RESEND_WEBHOOK_SECRET (Resend generates this per
 *     endpoint, in the `whsec_...` format Svix uses — NOT the same value as
 *     RESEND_API_KEY)
 *
 * SCOPE (per the issue's own explicit deferrals): this route flags the
 * recipient address as undeliverable for every company it owns (see
 * markEmailUndeliverableForAddress in lib/build/app-registry.ts) and stops
 * there. It does NOT attempt a `suppression.removed` un-flag path (no
 * un-bounce mechanism exists in this codebase yet — out of scope), and does
 * NOT run any kind of proactive sweep of Resend's suppression list — this is
 * purely the reactive, event-driven half of the fix.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyResendWebhook } from '@/lib/build/resend-webhook-verify'
import { markEmailUndeliverableForAddress } from '@/lib/build/app-registry'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ResendBounceData {
  email_id?: string
  from?: string
  to?: string[]
  subject?: string
  bounce?: {
    type?: string
    subType?: string
    message?: string
  }
}

interface ResendWebhookPayload {
  type?: string
  created_at?: string
  data?: ResendBounceData
}

export interface ResendWebhookResult {
  ok: boolean
  reason: string
  flaggedSlugs?: string[]
}

/** A permanent bounce is the durable "this address is dead" signal — matches
 *  Resend's own suppression-list semantics. A transient/soft bounce (no
 *  `type`, or any type other than 'Permanent') must NOT durably silence a
 *  recipient over what may be a one-time issue. */
function isDurableBounce(data: ResendBounceData | undefined): boolean {
  return (data?.bounce?.type || '').toLowerCase() === 'permanent'
}

/** Build the honest, non-fabricated reason string persisted on the company —
 *  Resend's own bounce subType/message when present, else a plain label. */
function reasonFor(type: string, data: ResendBounceData | undefined): string {
  if (type === 'email.complained') return 'complained'
  const subType = data?.bounce?.subType
  const message = data?.bounce?.message
  if (subType) return `bounced:${subType}`
  if (message) return `bounced:${message.slice(0, 120)}`
  return 'bounced'
}

/** Process one already-verified Resend webhook payload. Exported so tests
 *  can drive it directly without going through the HTTP handler's signature
 *  gate. Never throws — every branch returns a structured, honest result. */
export async function handleResendWebhookEvent(payload: ResendWebhookPayload): Promise<ResendWebhookResult> {
  const type = payload?.type || ''
  const data = payload?.data

  if (type !== 'email.bounced' && type !== 'email.complained') {
    return { ok: true, reason: `ignored_event_type:${type || 'unknown'}` }
  }

  if (type === 'email.bounced' && !isDurableBounce(data)) {
    return { ok: true, reason: 'transient_bounce_ignored' }
  }

  const recipients = Array.isArray(data?.to) ? data!.to! : []
  if (recipients.length === 0) {
    logger.warn('Resend webhook event had no recipient list', { type })
    return { ok: true, reason: 'no_recipients' }
  }

  const reason = reasonFor(type, data)
  const allFlagged: string[] = []
  for (const to of recipients) {
    const flagged = await markEmailUndeliverableForAddress(to, reason).catch((e) => {
      logger.warn('markEmailUndeliverableForAddress threw', { to, err: (e as Error)?.message })
      return []
    })
    allFlagged.push(...flagged)
  }

  logger.info('Resend webhook flagged undeliverable recipient(s)', {
    type, recipients, reason, flaggedSlugs: allFlagged,
  })
  return { ok: true, reason: 'flagged', flaggedSlugs: allFlagged }
}

export async function POST(request: NextRequest) {
  // Read fresh per-request (not a load-time module const) — this is a
  // security boundary, and a long-lived server process should never need a
  // restart for a rotated/newly-configured secret to take effect.
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET || ''
  const rawBody = await request.text()
  const verified = verifyResendWebhook(
    rawBody,
    {
      id: request.headers.get('svix-id'),
      timestamp: request.headers.get('svix-timestamp'),
      signature: request.headers.get('svix-signature'),
    },
    webhookSecret,
  )
  if (!verified) {
    logger.warn('Rejected Resend webhook with invalid/missing signature', {
      path: '/api/webhooks/resend',
      hasSecret: Boolean(webhookSecret),
    })
    return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 })
  }

  let payload: ResendWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = await handleResendWebhookEvent(payload)
  return NextResponse.json(result, { status: 200 })
}

export async function GET() {
  return NextResponse.json({
    service: 'resend-webhook',
    status: 'ready',
    configured: Boolean(process.env.RESEND_WEBHOOK_SECRET),
  })
}
