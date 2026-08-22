/**
 * POST /api/build/subscription/verify (#241 + #243) — post-checkout subscription
 * fulfillment for the Builder. After Stripe returns to
 * /build/{slug}?upgraded=1&session_id=… (see app/api/build/checkout/route.ts
 * success_url), the Live dashboard calls this to CONFIRM the session is real +
 * paid server-side, then persists the unlocked plan on the company so Builder
 * can read it back and gate features. Presence of a session_id in the URL is
 * never trusted on its own — verification happens against core → Stripe.
 *
 * #243 hook: once payment is verified, if the company was provisioned anonymously
 * (keyKind === 'tmp'), we claim its Instant DB project onto the now-paying founder's
 * account (tmp_ → PERMANENT) so it stops being a 72h throwaway. This is best-effort
 * and never fails the checkout confirmation.
 *
 * Body: { session_id, slug? }
 * Returns: { ok, paid, plan, planName, enrolled, claimed? } | { error }
 *
 * Return-URL verification is the MVP path; a hardened Stripe webhook is deferred
 * (see #241 residual). It's safe to call on page load with the returned id.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { setAppPlan, claimCompanyProject, setAppOwner } from '@/lib/build/app-registry'
import { markConverted } from '@/lib/build/learning'
import { reportConversion, gclidFromRequest } from '@/lib/build/conversions'

// Monthly $ value per plan — the conversion value sent to Google Ads.
const PLAN_VALUE: Record<string, number> = { pro: 49, launch: 49, business: 149, company: 149, enterprise: 999, cody_vcto: 4999 }

export const runtime = 'nodejs'

const CORE = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const KEY = process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY || ''

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const sessionId = String(body?.session_id || '')
  const slug = String(body?.slug || '')
  if (!sessionId) return Response.json({ error: 'session_id required' }, { status: 400 })

  try {
    const res = await fetch(`${CORE}/api/v1/public/pricing/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'X-API-Key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
      signal: AbortSignal.timeout(25000),
    })
    const data = await res.json().catch(() => null)
    // core wraps as { success, data: {...} }
    const d = data?.data || data
    const paid = Boolean(d?.paid)
    const plan = String(d?.plan_id || '')
    const planName = String(d?.plan_name || '')
    if (!res.ok || !paid || !plan) {
      return Response.json(
        { ok: false, paid, error: d?.detail || data?.detail || 'not verified' },
        { status: res.ok ? 200 : res.status },
      )
    }

    // Business+ auto-enroll into the nightly loop (flag only; cron is #243).
    const enrolled = plan === 'business' || plan === 'enterprise' || plan === 'cody_vcto'
    // Persist the plan on the company so Live can reflect it going forward.
    if (slug) {
      setAppPlan(slug, plan).catch(() => {})
      // #270: mark this company's build CONVERTED (+ plan) in the recursive learning
      // loop. Fire-and-forget — must never block or fail checkout confirmation.
      markConverted(slug, plan).catch(() => {})
    }

    // #207: report the PAID conversion to Google Ads (via core), keyed by the gclid
    // captured on ad landing — this is what makes Ads optimize toward subscribers.
    // Best-effort; no-op for organic (no gclid). Fire-and-forget.
    reportConversion({
      eventType: 'subscribed', eventName: 'Builder — Subscribed (paid)',
      sessionId: `builder-${slug || 'anon'}`,
      gclid: gclidFromRequest(request),
      value: PLAN_VALUE[plan] ?? 49, currency: 'USD', slug, plan,
    }).catch(() => {})

    // #243: upgrade a tmp_ Instant DB project → permanent now that the founder has
    // paid + has an account. Best-effort; never blocks checkout confirmation.
    let claimed: boolean | undefined
    if (slug) {
      const session = await auth().catch(() => null)
      const jwt = (session as any)?.accessToken as string | undefined
      // #253: stamp the paying founder as the owner so this company appears in
      // their "my companies" index. Best-effort — never blocks confirmation.
      const email = (session as any)?.user?.email as string | undefined
      if (email) setAppOwner(slug, email).catch(() => {})
      if (jwt) {
        const r = await claimCompanyProject(slug, jwt).catch(() => null)
        if (r?.ok) claimed = r.claimed
      }
    }

    return Response.json({ ok: true, paid: true, plan, planName, enrolled, claimed })
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e).slice(0, 100) }, { status: 502 })
  }
}
