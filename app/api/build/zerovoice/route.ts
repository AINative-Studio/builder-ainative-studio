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
 *
 * #522: this route provisions the real ZeroVoice number but, until now, never
 * captured the founder's credential for the runtime proxy
 * (app/api/primitive/[primitive]/[...path]/route.ts) to use later — the SAME
 * gap #443 fixed for ZeroCommerce/ZeroPipeline/AgentFlow/ZeroForms, just missed
 * here because ZeroVoice provisions via this separate, explicit route instead
 * of provision/route.ts's checkout flow. Captured the same way: a copy of the
 * founder's own refreshable AINative tokens, durably stored server-side
 * (lib/build/primitive-credentials.ts), so a DEPLOYED company's own Railway
 * service (COMPANY_SLUG env var, no live browser session) can still reach
 * ZeroVoice on this founder's behalf.
 */

import { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { auth } from '@/app/(auth)/auth'
import { getPlanStatus } from '@/lib/ainative/plan'
import { resolveApp, setAppZeroVoice } from '@/lib/build/app-registry'
import { provisionZeroVoiceNumber, zeroVoiceProvisionEnabled } from '@/lib/build/zerovoice'
import { storeFounderCredential } from '@/lib/build/primitive-credentials'

export const runtime = 'nodejs'

// Same set provision/route.ts already gates real provisioning behind.
const PAID_PLANS = new Set(['launch', 'company', 'pro', 'business', 'enterprise', 'cody_vcto'])

/**
 * #522: mirrors provision/route.ts's captureFounderCredentialForProxy exactly
 * — durably store the founder's refreshable token now, while their session is
 * live, so the runtime proxy can serve the DEPLOYED app on this founder's
 * behalf later without needing their browser present. Best-effort — a storage
 * failure just means the proxy has nothing to serve for this company; it
 * never blocks the (already-successful) number purchase itself.
 */
async function captureFounderCredentialForProxy(request: NextRequest, slug: string, jwt: string): Promise<void> {
  const rawToken = await getToken({ req: request, secret: process.env.AUTH_SECRET }).catch(() => null)
  if (!rawToken?.refreshToken && !rawToken?.accessToken) return
  await storeFounderCredential(
    slug,
    'zerovoice',
    jwt,
    rawToken.refreshToken as string | undefined,
    rawToken.expiresAt ? Math.max(0, Math.floor((Number(rawToken.expiresAt) - Date.now()) / 1000)) : undefined,
  ).catch(() => {})
}

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
    // Best-effort backfill: a company provisioned before #522 shipped may
    // have a number but no captured credential yet — capture it now that the
    // founder's session is live again, so the runtime proxy has something to
    // serve. Idempotent (storeFounderCredential just appends a fresh row).
    await captureFounderCredentialForProxy(request, slug, token)
    return Response.json({ ok: true, numberId: app.zerovoiceNumberId, e164: app.zerovoiceE164 })
  }

  const result = await provisionZeroVoiceNumber(token, slug, countryCode, type)
  if (!result.ok || !result.numberId || !result.e164) {
    return Response.json({ ok: false, reason: result.reason || 'provision_failed', status: result.status })
  }

  await setAppZeroVoice(slug, { numberId: result.numberId, e164: result.e164 }).catch(() => {})
  await captureFounderCredentialForProxy(request, slug, token)

  return Response.json({ ok: true, numberId: result.numberId, e164: result.e164 })
}
