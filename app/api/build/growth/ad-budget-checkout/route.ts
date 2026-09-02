/**
 * POST /api/build/growth/ad-budget-checkout (#449) — start a real Stripe
 * checkout to fund a Meta ad-test campaign's budget, by proxying to core's
 * new /api/v1/public/ad-budget/checkout (which owns the Stripe key and
 * computes the real, margin-reduced Meta budget server-side — mirrors
 * app/api/build/checkout/route.ts's exact proxy shape for subscription
 * checkout, since builder never holds a Stripe key of its own).
 *
 * Body: { slug, amountCents }
 * Returns: { url } (Stripe Checkout URL) or { error }
 *
 * Gated the same way ad-test/route.ts already is: feature flag, paid tier,
 * signed-in founder. The campaign itself is NOT created here — only after
 * core's webhook confirms the payment (see app/api/webhooks/ad-budget-confirmed).
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { getPlanStatus } from '@/lib/ainative/plan'
import { resolveApp } from '@/lib/build/app-registry'
import { growthAdTestingEnabled } from '@/lib/build/ad-testing'

export const runtime = 'nodejs'

const CORE = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'
const PAID_PLANS = new Set(['launch', 'company', 'pro', 'business', 'enterprise', 'cody_vcto'])

export async function POST(request: NextRequest) {
  if (!growthAdTestingEnabled()) {
    return Response.json({ ok: false, reason: 'disabled', detail: 'Growth ad-testing is not enabled in this environment.' })
  }

  const body = await request.json().catch(() => null)
  const slug = String(body?.slug || '').trim()
  if (!slug) return Response.json({ ok: false, reason: 'slug required' }, { status: 400 })

  const amountCents = Number(body?.amountCents)
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return Response.json({ ok: false, reason: 'amountCents required' }, { status: 400 })
  }

  const session = await auth().catch(() => null)
  const token = (session as any)?.accessToken
  if (!token) return Response.json({ ok: false, reason: 'signin' })

  let tier = 'hobbyist'
  try {
    const status = await getPlanStatus(token)
    tier = status.tier || 'hobbyist'
  } catch {
    // Fail closed — never let an unresolved tier lookup grant a real charge.
  }
  if (!PAID_PLANS.has(tier)) {
    return Response.json({ ok: false, reason: 'tier', tier })
  }

  const app = await resolveApp(slug).catch(() => null)
  if (!app) return Response.json({ ok: false, reason: 'company_not_found' }, { status: 404 })

  try {
    const res = await fetch(`${CORE}/api/v1/public/ad-budget/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        slug,
        amount_cents: Math.round(amountCents),
        origin: APP,
        success_url: `${APP}/build?screen=live&company=${encodeURIComponent(slug)}&ad_budget=pending`,
        cancel_url: `${APP}/build?screen=live&company=${encodeURIComponent(slug)}`,
      }),
      signal: AbortSignal.timeout(25000),
    })
    const data = await res.json().catch(() => null)
    const url = data?.url || data?.data?.url
    if (url) return Response.json({ ok: true, url })
    return Response.json({ ok: false, reason: data?.detail || 'checkout unavailable' }, { status: 502 })
  } catch (e: any) {
    return Response.json({ ok: false, reason: String(e?.message || e).slice(0, 100) }, { status: 502 })
  }
}
