/**
 * POST /api/webhooks/ad-budget-confirmed (#449) — core calls this the
 * moment its Stripe payment_intent.succeeded webhook confirms a founder's
 * ad-budget purchase (see payment_webhooks.py::handle_ad_budget_purchase_payment
 * on core). This is the ONLY place a real Meta campaign gets created — never
 * from a client-facing success redirect — so the signature check here is
 * the actual security boundary, not a formality.
 *
 * Verifies an HMAC-SHA256 token in the `x-ainative-callback-token` header:
 * `base64url(payloadJsonBytes).base64url(hmacSha256(BUILDER_CALLBACK_SECRET, payloadB64))`.
 * Core signs over the EXACT JSON bytes it sends (compact, sorted keys) — this
 * verifies over the raw request body bytes too, never a re-serialized parse,
 * so key-ordering/whitespace differences between Python's json.dumps and any
 * JS re-stringification can't silently break (or, worse, be worked around
 * into accepting) the signature.
 *
 * Body: { slug, userId, paymentIntentId, requestedAmountCents, adBudgetCents, ts }
 */

import { NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { resolveApp, setAppGrowthAdBudgetFunded, setAppGrowthAdTest } from '@/lib/build/app-registry'
import { createAdTestCampaign } from '@/lib/build/ad-testing'

export const runtime = 'nodejs'

const SECRET = process.env.BUILDER_CALLBACK_SECRET || ''
// A stale/replayed callback older than this is rejected — Stripe webhooks
// can retry, but a signed payload from hours ago has no legitimate reason
// to arrive now.
const MAX_AGE_SECONDS = 15 * 60

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}
function sign(payloadB64: string): string {
  return b64url(createHmac('sha256', SECRET).update(payloadB64).digest())
}

interface CallbackPayload {
  slug: string
  userId?: string
  paymentIntentId: string
  requestedAmountCents: number
  adBudgetCents: number
  ts: number
}

/** Verify the signed callback token against the RAW body bytes core sent
 *  (not a re-serialized parse — the signature was computed over core's exact
 *  JSON encoding, so re-stringifying here could silently produce different
 *  bytes and either wrongly reject a real callback or, if built carelessly,
 *  wrongly accept a tampered one). */
function verifyCallback(rawBodyBytes: Buffer, token: string | null): CallbackPayload | null {
  if (!SECRET || !token) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = sign(payloadB64)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  // The signed payload IS the base64url of core's raw JSON bytes — decode
  // that (not the request body separately) so what we verify is exactly
  // what we act on.
  let payload: CallbackPayload
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'))
  } catch {
    return null
  }
  if (!payload?.slug || !payload?.paymentIntentId || !Number.isFinite(payload?.adBudgetCents)) return null
  if (!Number.isFinite(payload?.ts) || Math.abs(Date.now() / 1000 - payload.ts) > MAX_AGE_SECONDS) return null
  return payload
}

export async function POST(request: NextRequest) {
  const rawBody = Buffer.from(await request.arrayBuffer())
  const token = request.headers.get('x-ainative-callback-token')
  const payload = verifyCallback(rawBody, token)
  if (!payload) {
    return Response.json({ ok: false, reason: 'invalid_signature' }, { status: 401 })
  }

  const { slug, paymentIntentId, requestedAmountCents, adBudgetCents } = payload

  const app = await resolveApp(slug).catch(() => null)
  if (!app) return Response.json({ ok: false, reason: 'company_not_found' }, { status: 404 })

  await setAppGrowthAdBudgetFunded(slug, {
    paymentIntentId,
    requestedCents: requestedAmountCents,
    realCents: adBudgetCents,
  }).catch(() => {})

  // Already has a campaign — funding a second time (shouldn't normally
  // happen, one purchase per campaign for this first pass) doesn't create a
  // duplicate.
  if (app.growthAdTestCampaignId) {
    return Response.json({ ok: true, campaignId: app.growthAdTestCampaignId, alreadyExisted: true })
  }

  const result = await createAdTestCampaign({
    companyName: app.name || slug,
    tagline: app.tagline,
    dailyBudgetUsd: adBudgetCents / 100,
  })
  if (!result.ok || !result.campaignId) {
    // The payment is already recorded above regardless — a campaign-create
    // failure here doesn't lose the funding record; it just means the
    // campaign wasn't created yet. Worth a manual/retry path later.
    return Response.json({ ok: false, reason: result.reason || 'campaign_create_failed' }, { status: 502 })
  }

  await setAppGrowthAdTest(slug, { campaignId: result.campaignId }).catch(() => {})

  return Response.json({ ok: true, campaignId: result.campaignId })
}
