/**
 * POST /api/webhooks/zerovoice-voice (2026-09-16, call counterpart to
 * #744's real SMS conversation) — a founder CALLS Cody, and has a real,
 * turn-by-turn voice conversation using the exact same askCody() pipeline
 * the dashboard chat and SMS webhook already share.
 *
 * ZeroVoice owns all real telephony mechanics (answering the call, Twilio
 * <Gather input="speech"> turning the caller's speech into text, <Say>
 * speaking the reply back, looping until hangup) — this endpoint's only job
 * is: given this turn's transcript, decide what Cody says next.
 *
 * Request (JSON, from ZeroVoice's voice-relay — see
 * app/routers/webhooks/twilio.py's inbound_voice/inbound_voice_gather in the
 * ZeroVoice repo):
 *   { CallSid, From, To, SpeechResult: string | null, Turn: number }
 * `SpeechResult` is null/absent on turn 1 (nothing said yet — Cody greets
 * first); populated on every later turn with what Twilio transcribed.
 *
 * Response (JSON): { say: string, hangup: boolean }
 * `hangup: true` ends the call after speaking; ZeroVoice re-gathers for the
 * next turn otherwise.
 *
 * AUTH: identical shared-secret convention to the SMS webhook
 * (`x-builder-webhook-secret`, timingSafeEqual against the SAME
 * ZEROVOICE_SMS_WEBHOOK_SECRET — one shared secret for both relay kinds,
 * matching how app/api/build/zerovoice/route.ts's configureRelaysForNumber
 * configures both with it).
 */

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { resolveAppByZeroVoiceNumber } from '@/lib/build/app-registry'
import { resolveFounderCredential, type FounderScopedPrimitive, type ResolvedCredential } from '@/lib/build/primitive-credentials'
import { chatScopeKey } from '@/lib/build/chat-store'
import { askCody } from '@/app/api/build/ask/route'
import { getPlanStatus } from '@/lib/ainative/plan'

export const runtime = 'nodejs'

const WEBHOOK_SECRET = process.env.ZEROVOICE_SMS_WEBHOOK_SECRET || ''

export interface CallTurnPayload {
  CallSid?: string
  From?: string
  To?: string
  SpeechResult?: string | null
  Turn?: number
  /** "inbound" | "outbound" — 2026-09-16, real fix for outbound calls Cody
   *  places itself (see ZeroVoice's companion fix). On an outbound call, To
   *  is the CALLEE (never the company's own number) and From is the
   *  company's — the reverse of an inbound call's shape. */
  Direction?: string
  /** Why Cody is calling, set only for an outbound call (see
   *  lib/build/zerovoice.ts's makeZeroVoiceCall `purpose` option). */
  CallPurpose?: string | null
  [key: string]: unknown
}

export interface CallTurnResult {
  say: string
  hangup: boolean
}

function secretMatches(provided: string | null): boolean {
  if (!WEBHOOK_SECRET) return false
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(WEBHOOK_SECRET)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** A spoken turn should be short — nobody wants a 6-sentence paragraph read
 *  aloud at them mid-call. Cody's dashboard/SMS system prompt already caps
 *  at ~2-4 sentences for a normal question; this trims defensively in case a
 *  reply runs long, so a caller never sits through an overlong monologue. */
const MAX_SPOKEN_CHARS = 600

/** A hard ceiling on how many turns one call can run — a live phone call
 *  costs real per-minute money and nobody should get stuck in an infinite
 *  loop with Cody. After this many turns, Cody wraps up and says goodbye. */
const MAX_TURNS = 12

/** Real bug found live (2026-09-16): loading the FULL shared conversation
 *  history (dashboard/SMS/voice all share one persisted thread) meant every
 *  call turn re-sent more accumulated context to the LLM than the last,
 *  pushing per-turn latency up until a real call timed out mid-conversation
 *  (measured: 4.7s → 6s → 7.6s → 12s+ timeout). A live caller needs a fast
 *  reply every turn, not the whole history — 6 turns (3 prior exchanges) is
 *  enough for real short-term continuity within a single call without
 *  letting prompt size (and therefore latency) grow unbounded. */
const MAX_VOICE_HISTORY_TURNS = 6

const CRED_FALLBACK_ORDER: FounderScopedPrimitive[] = [
  'zerovoice', 'zerocrm', 'zeroinvoice', 'serviceos', 'zerocommerce',
  'zeropipeline', 'agentflow', 'zeroforms', 'livestreaming', 'socialgraph',
]

function looksLikeGoodbye(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (!t) return false
  return /\b(bye|goodbye|good bye|that's all|thats all|hang up|talk later|gotta go|got to go)\b/.test(t)
}

export async function handleInboundCallTurn(payload: CallTurnPayload): Promise<CallTurnResult> {
  const to = String(payload.To || '').trim()
  const from = String(payload.From || '').trim()
  const speech = payload.SpeechResult != null ? String(payload.SpeechResult).trim() : ''
  const turn = Number(payload.Turn) || 1
  const isOutbound = payload.Direction === 'outbound'
  const callPurpose = payload.CallPurpose ? String(payload.CallPurpose).trim() : ''

  if (!to) {
    console.error('[zerovoice-voice-webhook] rejected: missing To number', { CallSid: payload.CallSid })
    return { say: "Sorry, I'm not able to take this call right now.", hangup: true }
  }

  // Real fix (2026-09-16): on an OUTBOUND call (Cody calling someone), `To`
  // is the CALLEE — never the company's own ZeroVoice number — while `From`
  // is the company's number. The reverse of an inbound call's shape.
  const companyNumber = isOutbound ? from : to
  const app = await resolveAppByZeroVoiceNumber(companyNumber).catch((e) => {
    console.error('[zerovoice-voice-webhook] resolveAppByZeroVoiceNumber threw:', e)
    return null
  })
  if (!app) {
    console.error(`[zerovoice-voice-webhook] no company matched ${isOutbound ? 'outbound caller' : 'inbound'} number ${companyNumber} — never answering on behalf of a fallback company`)
    return { say: "Sorry, this number isn't set up yet. Goodbye.", hangup: true }
  }

  if (turn === 1 && !speech && isOutbound) {
    // First turn of a call Cody placed itself: open with the real reason,
    // not the generic inbound greeting — this is backwards for a call Cody
    // initiated (the callee didn't ask Cody anything yet).
    return {
      say: callPurpose
        ? `Hi, this is Cody, calling on behalf of ${app.name || app.slug}. ${callPurpose}`
        : `Hi, this is Cody, calling on behalf of ${app.name || app.slug}.`,
      hangup: false,
    }
  }

  if (turn === 1 && !speech) {
    // First turn: greet by name, no question to answer yet.
    return {
      say: `Hi, this is Cody, the AI co-founder for ${app.name || app.slug}. What can I help you with?`,
      hangup: false,
    }
  }

  if (!speech) {
    // A later turn with no transcribed speech — the caller went quiet.
    return { say: "I didn't catch that. Anything else, or should I let you go?", hangup: false }
  }

  if (turn >= MAX_TURNS) {
    return { say: "I need to wrap up this call now — text me anytime to keep going. Goodbye!", hangup: true }
  }

  const cred = await (async (): Promise<ResolvedCredential> => {
    for (const primitive of CRED_FALLBACK_ORDER) {
      const attempt = await resolveFounderCredential(app.slug, primitive)
      if (attempt.ok) return attempt
    }
    return { ok: false, reason: 'not_provisioned' }
  })()

  let tier = 'hobbyist'
  if (cred.ok && cred.accessToken) {
    tier = await getPlanStatus(cred.accessToken).then((s) => s.tier || 'hobbyist').catch(() => 'hobbyist')
  }

  const ownerKey = app.ownerEmail ? app.ownerEmail.trim().toLowerCase() : 'guest:anon'
  const scopeKey = chatScopeKey(ownerKey, app.slug)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'

  const result = await askCody({
    question: speech,
    idea: app.idea || '',
    companyName: app.name || app.slug,
    track: app.track === 'app' ? 'app' : 'company',
    companyId: app.slug,
    scopeKey,
    tier,
    baseUrl,
    // Real bug found live (2026-09-16): a real call timed out mid-
    // conversation because every turn re-sent the FULL shared history
    // (default cap 100 turns) to the LLM, and turn latency climbed with it
    // (4.7s → 6s → 7.6s → 12s+ timeout) against both a live caller and
    // Twilio's own hard 15s webhook-response ceiling. Voice needs a much
    // tighter window than dashboard/SMS — enough for real short-term
    // continuity within this call, not the whole persisted thread.
    historyLimit: MAX_VOICE_HISTORY_TURNS,
  }).catch((e) => {
    console.error('[zerovoice-voice-webhook] askCody threw:', e)
    return null
  })

  const wantsToEnd = looksLikeGoodbye(speech)

  if (result && 'answer' in result && result.answer) {
    const say = result.answer.slice(0, MAX_SPOKEN_CHARS)
    return { say: wantsToEnd ? `${say} Goodbye!` : say, hangup: wantsToEnd }
  }

  return {
    say: "Sorry, I'm having trouble answering right now. Text this number anytime and I'll follow up. Goodbye!",
    hangup: true,
  }
}

export async function POST(req: NextRequest) {
  const provided = req.headers.get('x-builder-webhook-secret')
  if (!secretMatches(provided)) {
    return NextResponse.json({ say: 'Sorry, this call could not be authenticated.', hangup: true }, { status: 401 })
  }

  const body = await req.text()
  let payload: CallTurnPayload
  try {
    payload = JSON.parse(body)
  } catch {
    return NextResponse.json({ say: 'Sorry, something went wrong.', hangup: true }, { status: 400 })
  }

  const result = await handleInboundCallTurn(payload)
  return NextResponse.json(result, { status: 200 })
}

export async function GET() {
  return NextResponse.json({
    service: 'zerovoice-voice-webhook',
    status: 'ready',
    configured: Boolean(WEBHOOK_SECRET),
  })
}
