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
 * Gated on: the feature flag, a signed-in founder, and a real company. The
 * campaign itself is NOT created here — only after core's webhook confirms the
 * payment (see app/api/webhooks/ad-budget-confirmed).
 *
 * NO PLAN-TIER GATE (#1017, product direction confirmed 2026-10-10). Ad
 * campaigns are not gated on subscription tier: founders pay for prepaid ad
 * CREDITS to fund a campaign, and a free-tier founder proving demand for their
 * idea is precisely who that is for. This route previously required
 * `isPaidTier`, which made the funding flow a dead end once #1017's auto-create
 * path started handing every founder a real, PAUSED campaign plus a prompt to
 * fund it: the founder followed the prompt and was refused with
 * `reason: 'tier'` at the moment of payment. Purchasing credits IS the
 * founder's consent to real spend; their plan is irrelevant to it.
 *
 * What still gates a real charge, deliberately unchanged:
 *   - the GROWTH_AD_TESTING_ENABLED flag;
 *   - a signed-in founder holding a real core access token;
 *   - that token being forwarded to core, which verifies the founder actually
 *     owns `slug` before issuing a Stripe session — builder never asserts
 *     ownership on the founder's behalf;
 *   - a resolvable company;
 *   - the 20% margin never disclosed to Meta, computed server-side on core
 *     (app/api/v1/endpoints/ad_budget.py), never trusted from the client.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { resolveApp } from '@/lib/build/app-registry'
import { growthAdTestingEnabled } from '@/lib/build/ad-testing'

export const runtime = 'nodejs'

const CORE = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'

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

  // Authentication is the real boundary here and is UNCHANGED: an anonymous
  // caller can never reach Stripe, and the token below is the founder's own —
  // core authorizes the purchase against it.
  const session = await auth().catch(() => null)
  const token = (session as any)?.accessToken
  if (!token) return Response.json({ ok: false, reason: 'signin' })

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
