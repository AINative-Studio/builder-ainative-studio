/**
 * POST /api/build/company-comms (#733, child of #414) — the real entry point
 * for Cody (or the nightly loop) to actually text/call a company's customer
 * on that company's behalf, once the company has a real, provisioned
 * ZeroVoice number.
 *
 * This is NOT a new proxy path — app/api/primitive/[primitive]/[...path]/
 * route.ts already forwards `/api/primitive/zerovoice/...` straight through
 * to ZeroVoice's real API for a generated app that wants to call it itself.
 * This route is the higher-level, company-scoped action Cody's own runtime
 * calls: given a company slug it resolves BOTH the founder's ZeroVoice
 * credential (lib/build/primitive-credentials.ts) AND the company's own
 * provisioned number (lib/build/app-registry.ts's zerovoiceE164) itself, so
 * the caller never has to know either detail — just the company + the
 * message.
 *
 * Body: { slug: string, action: 'sms' | 'call', to: string, body?: string,
 *         record?: boolean }
 *   - action 'sms' requires `body` (the message text).
 *   - action 'call' accepts an optional `record` flag.
 * Returns: { ok: true, sid } | { ok: true, callId } | { ok: false, reason }
 *
 * Fails closed at every step, matching this codebase's established pattern
 * (see lib/build/zerovoice.ts's own doc comments): a company with no
 * provisioned ZeroVoice number, no captured founder credential, or a real
 * ZeroVoice API failure all return an honest `{ok:false, reason}` — this
 * route never fabricates a sid/callId.
 */

import { NextRequest } from 'next/server'
import { resolveApp } from '@/lib/build/app-registry'
import { resolveFounderCredential } from '@/lib/build/primitive-credentials'
import { sendZeroVoiceSms, makeZeroVoiceCall } from '@/lib/build/zerovoice'

export const runtime = 'nodejs'

const E164_RE = /^\+[1-9]\d{1,14}$/

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const slug = String(body?.slug || '').trim()
  const action = body?.action
  const to = String(body?.to || '').trim()

  if (!slug) return Response.json({ ok: false, reason: 'slug required' }, { status: 400 })
  if (action !== 'sms' && action !== 'call') {
    return Response.json({ ok: false, reason: 'invalid_action' }, { status: 400 })
  }
  if (!to) return Response.json({ ok: false, reason: 'to required' }, { status: 400 })
  if (!E164_RE.test(to)) {
    return Response.json({ ok: false, reason: 'to_must_be_e164' }, { status: 400 })
  }
  if (action === 'sms' && (!body?.body || !String(body.body).trim())) {
    return Response.json({ ok: false, reason: 'body required for sms' }, { status: 400 })
  }

  const app = await resolveApp(slug).catch(() => null)
  if (!app) return Response.json({ ok: false, reason: 'company_not_found' }, { status: 404 })

  if (!app.zerovoiceProvisioned || !app.zerovoiceE164) {
    return Response.json({ ok: false, reason: 'no_zerovoice_number_provisioned' })
  }

  const cred = await resolveFounderCredential(slug, 'zerovoice')
  if (!cred.ok || !cred.accessToken) {
    return Response.json({ ok: false, reason: cred.reason || 'no_founder_credential' })
  }

  if (action === 'sms') {
    const result = await sendZeroVoiceSms(cred.accessToken, app.zerovoiceE164, to, String(body.body))
    if (!result.ok) return Response.json({ ok: false, reason: result.reason || 'send_failed', status: result.status })
    return Response.json({ ok: true, sid: result.sid })
  }

  // action === 'call'
  const record = body?.record === true
  const result = await makeZeroVoiceCall(cred.accessToken, app.zerovoiceE164, to, { record })
  if (!result.ok) return Response.json({ ok: false, reason: result.reason || 'call_failed', status: result.status })
  return Response.json({ ok: true, callId: result.callId })
}
