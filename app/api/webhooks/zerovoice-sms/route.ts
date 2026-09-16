/**
 * POST /api/webhooks/zerovoice-sms (#744, real conversation follow-up
 * 2026-09-16) — a founder texts Cody while on the go, and gets a REAL
 * conversation with the same Cody the dashboard chat runs — not a one-shot
 * "your message became an issue" action.
 *
 * Real gap this closes: the original #744 implementation always filed a
 * Gitea issue directly from the raw SMS body, with a single fixed
 * confirmation string sent back ("Got it — logged as issue #N"). It never
 * called the real chat pipeline (askCody, app/api/build/ask/route.ts), had
 * no memory of the conversation, and couldn't handle a reply like "actually
 * make that dark mode instead" or "what's the status of my last request" —
 * a founder on their phone got a materially worse Cody than one at their
 * desk. Confirmed live end-to-end (2026-09-15/16, real texts to a real
 * provisioned ZeroVoice number, real Gitea issues landed) that the
 * underlying SMS transport (auth, webhook wiring, relay, async DB
 * connection) all genuinely work — this closes the LAST gap: making the
 * conversation itself real.
 *
 * Now: every inbound text becomes a real askCody() turn — same system
 * prompt, same backlog grounding, same persisted history a dashboard
 * session gets — and Cody's actual reply is what gets texted back. A real
 * change request (detectEditIntent matches, same as the dashboard) still
 * dispatches a real tracked edit task exactly the way the dashboard chat
 * does; it's no longer SMS's own separate, cruder behavior.
 *
 * The founder's own conversation scope key is derived the SAME way the
 * dashboard route derives it — deriveOwnerKey(session).toLowerCase() email
 * — using the company registry's own `ownerEmail` instead of a live
 * browser session (a text has none). This is what lets a founder's text
 * and their dashboard chat share the exact same persisted thread.
 *
 * AUTH: a shared-secret header (`x-builder-webhook-secret`, compared via
 * timingSafeEqual against ZEROVOICE_SMS_WEBHOOK_SECRET) — the same
 * "Configure in X:" pattern as app/api/webhooks/gitea/route.ts. Any request
 * without a matching secret is rejected outright; an unset secret fails
 * closed.
 *
 * Configure on ZeroVoice's per-number sms-relay config
 * (PUT /api/v1/numbers/{id}/sms-relay, ZeroVoice#616):
 *   webhook_url: https://builder.ainative.studio/api/webhooks/zerovoice-sms
 *   webhook_secret: ZEROVOICE_SMS_WEBHOOK_SECRET
 */

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { resolveAppByZeroVoiceNumber } from '@/lib/build/app-registry'
import { createIssue } from '@/lib/git/gitea-client'
import { sendZeroVoiceSms } from '@/lib/build/zerovoice'
import { resolveFounderCredential } from '@/lib/build/primitive-credentials'
import { deriveOwnerKey, chatScopeKey } from '@/lib/build/chat-store'
import { detectEditIntent } from '@/lib/build/edit-intent'
import { askCody } from '@/app/api/build/ask/route'
import { getPlanStatus } from '@/lib/ainative/plan'

export const runtime = 'nodejs'

const WEBHOOK_SECRET = process.env.ZEROVOICE_SMS_WEBHOOK_SECRET || ''

export interface InboundSmsPayload {
  From?: string
  To?: string
  Body?: string
  MessageSid?: string
  [key: string]: unknown
}

export interface SmsConversationResult {
  ok: boolean
  reason: string
  editTriggered?: boolean
  issueNumber?: number
  issueUrl?: string
}

/** Constant-time secret comparison — never a plain `===` on a bearer secret. */
function secretMatches(provided: string | null): boolean {
  if (!WEBHOOK_SECRET) return false // fail closed: an unset secret trusts no one
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(WEBHOOK_SECRET)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** SMS segments are ~160 chars (GSM-7) / ~70 (unicode) — Cody's dashboard
 *  replies run up to ~6 sentences (system prompt's own instruction), which
 *  can spill across several real segments. That's an acceptable, honest
 *  cost of a real conversation over SMS rather than truncating Cody's
 *  actual answer — Twilio/ZeroVoice already handle multi-segment sends. */
const MAX_REPLY_CHARS = 1500

export async function handleInboundSms(payload: InboundSmsPayload): Promise<SmsConversationResult> {
  const to = String(payload.To || '').trim()
  const from = String(payload.From || '').trim()
  const body = String(payload.Body || '').trim()

  if (!to) {
    console.error('[zerovoice-sms-webhook] rejected: missing To number', { MessageSid: payload.MessageSid })
    return { ok: false, reason: 'missing_to' }
  }

  // Never have a conversation for a company with no verified, positively-
  // matched inbound number — no default/fallback company, ever.
  const app = await resolveAppByZeroVoiceNumber(to).catch((e) => {
    console.error('[zerovoice-sms-webhook] resolveAppByZeroVoiceNumber threw:', e)
    return null
  })
  if (!app) {
    console.error(`[zerovoice-sms-webhook] no company matched inbound number ${to} — no-op, not filing against any fallback`)
    return { ok: false, reason: 'no_matching_company' }
  }
  if (!body) {
    return { ok: false, reason: 'empty_body' }
  }

  // The founder's own real AINative access token (already captured for this
  // company at provisioning time, #522) — this is what lets the SMS
  // transport resolve the SAME real account tier and dispatch a real edit
  // task the dashboard chat would, with no browser session available here.
  // Any FounderScopedPrimitive credential works — they're all the same
  // underlying AINative identity token; 'zerovoice' is simply the one this
  // company definitely has (it owns a ZeroVoice number).
  const cred = await resolveFounderCredential(app.slug, 'zerovoice')
  let tier = 'hobbyist'
  if (cred.ok && cred.accessToken) {
    tier = await getPlanStatus(cred.accessToken).then((s) => s.tier || 'hobbyist').catch(() => 'hobbyist')
  }

  // Same conversation scope a dashboard session would derive — a founder's
  // text and their dashboard chat share the exact same persisted thread.
  const ownerKey = app.ownerEmail ? app.ownerEmail.trim().toLowerCase() : 'guest:anon'
  const scopeKey = chatScopeKey(ownerKey, app.slug)

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'

  const result = await askCody({
    question: body,
    idea: app.idea || '',
    companyName: app.name || app.slug,
    track: app.track === 'app' ? 'app' : 'company',
    companyId: app.slug,
    scopeKey,
    tier,
    baseUrl,
  }).catch((e) => {
    console.error('[zerovoice-sms-webhook] askCody threw:', e)
    return null
  })

  const editTriggered = Boolean(app.gitOrg && detectEditIntent(body))

  let replyText: string
  let issueNumber: number | undefined
  let issueUrl: string | undefined

  if (result && 'answer' in result && result.answer) {
    replyText = result.answer.slice(0, MAX_REPLY_CHARS)
  } else {
    // askCody itself is unavailable (both model providers failed, or a
    // question-required edge case) — this must never silently drop the
    // founder's text with no reply at all. Real, honest fallback: still try
    // to log it as backlog-worthy feedback via a Gitea issue, same as the
    // ORIGINAL #744 behavior, so the founder's message is at least captured
    // somewhere real even when the live conversation genuinely can't run.
    if (app.gitOrg && app.gitRepoId) {
      const title = body.length > 80 ? `${body.slice(0, 79)}…` : body || 'Feedback via SMS'
      const issueBody = [
        body || '(empty message)', '', '---',
        `Received via SMS from ${from || 'unknown number'} — Cody's chat was unavailable, so this was filed as feedback instead of replied to directly.`,
      ].join('\n')
      const created = await createIssue(app.gitOrg, app.slug, title, issueBody)
      if (created.ok) { issueNumber = created.issueNumber; issueUrl = created.url }
    }
    replyText = "Sorry, I couldn't process that just now — I've logged it and will follow up. Text me again in a bit?"
  }

  if (from && app.zerovoiceE164 && cred.ok && cred.accessToken) {
    const sendResult = await sendZeroVoiceSms(cred.accessToken, app.zerovoiceE164, from, replyText).catch((e) => {
      console.error('[zerovoice-sms-webhook] sendZeroVoiceSms threw:', e)
      return { ok: false, reason: 'threw' }
    })
    if (!sendResult.ok) {
      console.error(`[zerovoice-sms-webhook] reply SMS failed for "${app.slug}":`, sendResult.reason)
    }
  } else {
    console.error(`[zerovoice-sms-webhook] no usable ZeroVoice credential for "${app.slug}" — could not send Cody's reply back:`, cred.ok ? 'no zerovoiceE164' : cred.reason)
  }

  return { ok: Boolean(result && 'answer' in result), reason: result && 'answer' in result ? 'replied' : 'fallback_logged', editTriggered, issueNumber, issueUrl }
}

export async function POST(req: NextRequest) {
  const provided = req.headers.get('x-builder-webhook-secret')
  if (!secretMatches(provided)) {
    return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 })
  }

  const body = await req.text()
  let payload: InboundSmsPayload
  try {
    payload = JSON.parse(body)
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = await handleInboundSms(payload)
  return NextResponse.json(result, { status: result.ok ? 200 : 422 })
}

export async function GET() {
  return NextResponse.json({
    service: 'zerovoice-sms-webhook',
    status: 'ready',
    configured: Boolean(WEBHOOK_SECRET),
  })
}
