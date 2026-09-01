/**
 * /api/build/zerovoice (#415, child of #414) — explicit, founder-triggered
 * "get a phone number" action for a company.
 *
 * ZeroVoice carries a REAL, non-trivial recurring cost (~$1.15/month per
 * number + usage — confirmed via ZeroVoice's own ops docs). Unlike every
 * other primitive (ZeroPipeline/ZeroCommerce/ZeroForms/AgentFlow/
 * OpenCapStack), this is deliberately NOT auto-provisioned in
 * provision/route.ts's checkout flow — not every paid company needs
 * telephony, and it's real recurring cost the founder should knowingly opt
 * into. This route is the explicit action a founder takes (e.g. clicking
 * "Get a phone number" in the dashboard) — never called automatically.
 *
 * Triple-gated, matching the issue's own explicit requirements:
 *   1. ZEROVOICE_PROVISION_ENABLED=true (env flag, default off)
 *   2. Paid tier (same PAID_PLANS check provision/route.ts already uses)
 *   3. Signed-in founder with a real AINative JWT
 *
 * POST { slug, countryCode?, type? } → { ok, numberId?, e164?, reason? }
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { getPlanStatus } from '@/lib/ainative/plan'
import { resolveApp, setAppZeroVoice } from '@/lib/build/app-registry'
import { provisionZeroVoiceNumber, zeroVoiceProvisionEnabled } from '@/lib/build/zerovoice'

export const runtime = 'nodejs'

// Same set provision/route.ts already gates real provisioning behind.
const PAID_PLANS = new Set(['launch', 'company', 'pro', 'business', 'enterprise', 'cody_vcto'])

export async function POST(request: NextRequest) {
  if (!zeroVoiceProvisionEnabled()) {
    return Response.json({ ok: false, reason: 'disabled', detail: 'ZeroVoice provisioning is not enabled in this environment.' })
  }

  const body = await request.json().catch(() => null)
  const slug = String(body?.slug || '').trim()
  if (!slug) return Response.json({ ok: false, reason: 'slug required' }, { status: 400 })

  const countryCode = typeof body?.countryCode === 'string' && body.countryCode ? body.countryCode : 'US'
  const type = body?.type === 'toll_free' || body?.type === 'mobile' ? body.type : 'local'

  const session = await auth().catch(() => null)
  const token = (session as any)?.accessToken
  if (!token) return Response.json({ ok: false, reason: 'signin' })

  let tier = 'hobbyist'
  try {
    const status = await getPlanStatus(token)
    tier = status.tier || 'hobbyist'
  } catch {
    // Fail closed to the un-paid default — never grant a real, billed
    // resource on an unresolved tier lookup.
  }
  if (!PAID_PLANS.has(tier)) {
    return Response.json({ ok: false, reason: 'tier', tier })
  }

  const app = await resolveApp(slug).catch(() => null)
  if (!app) return Response.json({ ok: false, reason: 'company_not_found' }, { status: 404 })

  // Already provisioned — return the existing number rather than attempting
  // another purchase (matches the idempotency guard already inside
  // provisionZeroVoiceNumber, but short-circuits before even hitting the
  // real API when we already know the answer from our own registry).
  if (app.zerovoiceProvisioned && app.zerovoiceNumberId && app.zerovoiceE164) {
    return Response.json({ ok: true, numberId: app.zerovoiceNumberId, e164: app.zerovoiceE164 })
  }

  const result = await provisionZeroVoiceNumber(token, slug, countryCode, type)
  if (!result.ok || !result.numberId || !result.e164) {
    return Response.json({ ok: false, reason: result.reason || 'provision_failed', status: result.status })
  }

  await setAppZeroVoice(slug, { numberId: result.numberId, e164: result.e164 }).catch(() => {})

  return Response.json({ ok: true, numberId: result.numberId, e164: result.e164 })
}
