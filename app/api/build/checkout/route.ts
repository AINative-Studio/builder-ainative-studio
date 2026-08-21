/**
 * POST /api/build/checkout (#207) — start a real Stripe checkout for a Builder
 * subscription tier, by proxying to core's public pricing checkout (which owns
 * the Stripe key). Tiers reuse the canonical AINative prices:
 *   Pro $49  price_1TGUVd… | Business $149 price_1TGUVe… | Enterprise $999 price_1Ti31L…
 *
 * Body: { priceId, plan, companyId? }
 * Returns: { url }  (Stripe Checkout URL) or { error }
 */

import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

const CORE = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  const priceId = String(b?.priceId || '')
  const plan = String(b?.plan || '')
  if (!priceId || !plan) return Response.json({ error: 'priceId and plan required' }, { status: 400 })

  const companyId = b?.companyId ? String(b.companyId) : ''
  try {
    const res = await fetch(`${CORE}/api/v1/public/pricing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_id: plan,
        stripe_price_id: priceId,
        // return to the Builder company/live page after checkout
        success_url: `${APP}/build${companyId ? `/${companyId}` : ''}?upgraded=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${APP}/build`,
      }),
      signal: AbortSignal.timeout(25000),
    })
    const data = await res.json().catch(() => null)
    // core wraps as { success, data: { url } } or returns { url } — support both
    const url = data?.url || data?.data?.url
    if (url) return Response.json({ url })
    return Response.json({ error: data?.detail || 'checkout unavailable' }, { status: 502 })
  } catch (e: any) {
    return Response.json({ error: String(e?.message || e).slice(0, 100) }, { status: 502 })
  }
}
