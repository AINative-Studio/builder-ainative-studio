/**
 * POST /api/webhooks/zerovoice-sms (#744) — a founder texts Cody a quick
 * feature idea while on the go, and it becomes a real tracked issue in that
 * company's own Gitea repo.
 *
 * REAL, CONFIRMED GAP (investigated 2026-09-14 against ZeroVoice's live
 * openapi.json, fetched fresh from https://zerovoice-production.up.railway.app/openapi.json):
 * there is NO documented way to register a per-number inbound-SMS relay
 * target on ZeroVoice's side.
 *   - `PUT /api/v1/numbers/{number_id}/config` takes a `NumberConfigUpdateRequest`
 *     body: { friendly_name?, status?, routing? }. `routing` is a free-form
 *     object (additionalProperties: true), but its OWN documented purpose
 *     (per the endpoint's description: "Modify friendly name, status, and
 *     routing targets (IVR, queues, voicemail)") and the `RoutingOptionsResponse`
 *     schema it pairs with (`ivr`/`queues`/`agents`, each a `RoutingOption`
 *     {id, name, type}) are entirely about VOICE call routing — there is no
 *     documented SMS-relay field anywhere in that schema.
 *   - The only "forward" concept in the whole spec is `ForwardRequest` ({to,
 *     ring_timeout_seconds}), used exclusively by `POST /api/v1/calls/{call_id}/forward`
 *     — a live call-forward action, unrelated to SMS and unrelated to number
 *     config.
 *   - `PUT /api/v1/settings/twilio`'s `status_callback_url` field is an
 *     ACCOUNT-level Twilio credential setting (requires account_sid/auth_token),
 *     not a per-number/per-tenant SMS-inbound-relay target.
 *   - Twilio's own inbound webhook lands on ZeroVoice's `POST
 *     /api/v1/sms/webhooks/inbound` directly (Twilio-shaped params: From, To,
 *     Body, MessageSid, AccountSid, MessagingServiceSid, NumMedia — confirmed
 *     from that endpoint's own operation description) and ZeroVoice handles
 *     STOP/START compliance keywords there BEFORE anything downstream ever
 *     sees the message — this route must never duplicate or bypass that.
 *
 * So this route is built ready to RECEIVE whatever ZeroVoice would relay
 * (the same Twilio-shaped From/To/Body/MessageSid fields, since that's the
 * only inbound-SMS shape that exists anywhere in ZeroVoice's real API), but
 * nothing on ZeroVoice's side calls it yet. Wiring the actual relay remains a
 * genuine, currently-unsolved gap on ZeroVoice's side (a real feature request
 * against AINative-Studio/ZeroVoice, not something fakeable here) — do not
 * assume this route is reachable from a real inbound text until that ships.
 *
 * AUTH (interim, pending the above): a shared-secret header
 * (`x-builder-webhook-secret`, compared via timingSafeEqual against
 * ZEROVOICE_SMS_WEBHOOK_SECRET) — the same "Configure in X:" pattern as
 * app/api/webhooks/gitea/route.ts, just with a plain shared secret instead
 * of an HMAC-over-body, since ZeroVoice's real relay payload/signature shape
 * is unconfirmed (there is nothing to configure it against yet). Any request
 * without a matching secret is rejected outright — never processed
 * unsigned, and the secret must be non-empty (an unset secret fails closed,
 * unlike the Gitea webhook's dev-mode "no secret = trust everyone").
 *
 * Configure in ZeroVoice (once its inbound-relay mechanism exists):
 *   URL: https://builder.ainative.studio/api/webhooks/zerovoice-sms
 *   Header: x-builder-webhook-secret: ZEROVOICE_SMS_WEBHOOK_SECRET
 *   Body: relayed Twilio-shaped SMS fields (From/To/Body/MessageSid at minimum)
 */

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { resolveAppByZeroVoiceNumber } from '@/lib/build/app-registry'
import { createIssue } from '@/lib/git/gitea-client'
import { sendZeroVoiceSms } from '@/lib/build/zerovoice'
import { resolveFounderCredential } from '@/lib/build/primitive-credentials'

export const runtime = 'nodejs'

const WEBHOOK_SECRET = process.env.ZEROVOICE_SMS_WEBHOOK_SECRET || ''

/** Max characters of the SMS body used as the issue title — the rest (if
 *  any) still lands in full in the issue body, never truncated there. */
const TITLE_MAX_LEN = 80

export interface InboundSmsPayload {
  From?: string
  To?: string
  Body?: string
  MessageSid?: string
  [key: string]: unknown
}

export interface SmsToIssueResult {
  ok: boolean
  reason: string
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

/** Derive a sensibly-truncated issue title from the raw SMS body. PURE. */
export function titleFromSmsBody(body: string): string {
  const clean = String(body || '').trim().replace(/\s+/g, ' ')
  if (!clean) return 'Feature idea via SMS'
  return clean.length > TITLE_MAX_LEN ? `${clean.slice(0, TITLE_MAX_LEN - 1)}…` : clean
}

/** Build the issue body — the full SMS text plus provenance (never lossy,
 *  even when the title above had to truncate). PURE. */
export function issueBodyFromSms(body: string, fromE164: string, receivedAtIso: string): string {
  return [
    String(body || '').trim() || '(empty message)',
    '',
    '---',
    `Received via SMS from ${fromE164 || 'unknown number'} at ${receivedAtIso}.`,
    'Filed automatically by Cody — no human review yet.',
  ].join('\n')
}

/**
 * Core orchestration: resolve the company from the inbound `To` number,
 * create the Gitea issue, optionally confirm back over SMS. Never throws —
 * every branch returns a structured, honest result, and every failure
 * (unmatched number, missing git repo, Gitea failure) is logged with enough
 * detail to diagnose, since a founder texting in expects this to have
 * worked and there is no other feedback loop if it silently didn't.
 */
export async function handleInboundSms(payload: InboundSmsPayload): Promise<SmsToIssueResult> {
  const to = String(payload.To || '').trim()
  const from = String(payload.From || '').trim()
  const body = String(payload.Body || '')

  if (!to) {
    console.error('[zerovoice-sms-webhook] rejected: missing To number', { MessageSid: payload.MessageSid })
    return { ok: false, reason: 'missing_to' }
  }

  // Never create an issue for a company with no verified, positively-matched
  // inbound number — no default/fallback company, ever.
  const app = await resolveAppByZeroVoiceNumber(to).catch((e) => {
    console.error('[zerovoice-sms-webhook] resolveAppByZeroVoiceNumber threw:', e)
    return null
  })
  if (!app) {
    console.error(`[zerovoice-sms-webhook] no company matched inbound number ${to} — no-op, not filing against any fallback`)
    return { ok: false, reason: 'no_matching_company' }
  }

  if (!app.gitOrg || !app.gitRepoId) {
    console.error(`[zerovoice-sms-webhook] company "${app.slug}" matched but has no provisioned Gitea repo — no-op`)
    return { ok: false, reason: 'no_git_repo' }
  }

  const receivedAtIso = new Date().toISOString()
  const title = titleFromSmsBody(body)
  const issueBody = issueBodyFromSms(body, from, receivedAtIso)

  const created = await createIssue(app.gitOrg, app.slug, title, issueBody)
  if (!created.ok) {
    console.error(`[zerovoice-sms-webhook] createIssue failed for "${app.slug}":`, created.reason)
    return { ok: false, reason: created.reason || 'create_issue_failed' }
  }

  // Optional, non-blocking confirmation SMS (#733's sendZeroVoiceSms). A
  // failure here must never undo or mask the already-successful issue
  // creation above — it's best-effort feedback, not part of the contract.
  if (created.issueNumber && app.zerovoiceE164 && from) {
    try {
      const cred = await resolveFounderCredential(app.slug, 'zerovoice')
      if (cred.ok && cred.accessToken) {
        const confirmation = await sendZeroVoiceSms(
          cred.accessToken,
          app.zerovoiceE164,
          from,
          `Got it — logged as issue #${created.issueNumber}.`,
        )
        if (!confirmation.ok) {
          console.error(`[zerovoice-sms-webhook] confirmation SMS failed for "${app.slug}":`, confirmation.reason)
        }
      } else {
        console.error(`[zerovoice-sms-webhook] no usable ZeroVoice credential for "${app.slug}" — skipping confirmation SMS:`, cred.reason)
      }
    } catch (e) {
      console.error('[zerovoice-sms-webhook] confirmation SMS threw:', e)
    }
  }

  return { ok: true, reason: 'issue_created', issueNumber: created.issueNumber, issueUrl: created.url }
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
