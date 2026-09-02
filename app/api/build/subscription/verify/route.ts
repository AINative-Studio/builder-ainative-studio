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
import {
  setAppPlan,
  claimCompanyProject,
  setAppOwner,
  setAppRailwayService,
  resolveApp,
} from '@/lib/build/app-registry'
import { markConverted } from '@/lib/build/learning'
import { reportConversion, gclidFromRequest } from '@/lib/build/conversions'
import { reportMetaConversion, fbcFromRequest, fbpFromRequest } from '@/lib/build/meta-capi'
import { deployCompanyFromGitea, companyDeployEnabled } from '@/lib/build/company-deploy'
import { BUILDER_WORKSPACE_ID } from '@/lib/build/instant-db'
import { deriveOwnerKey } from '@/lib/build/chat-store'
import { creditReferrerOnSubscribe } from '@/lib/build/referral'
import { enrollCompany, isEnrolled } from '@/lib/build/loop-enrollment'

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

    // Business+ auto-enroll into the nightly loop (cron itself is #243).
    const enrolled = plan === 'business' || plan === 'enterprise' || plan === 'cody_vcto'
    // Persist the plan on the company so Live can reflect it going forward.
    if (slug) {
      setAppPlan(slug, plan).catch(() => {})
      // #270: mark this company's build CONVERTED (+ plan) in the recursive learning
      // loop. Fire-and-forget — must never block or fail checkout confirmation.
      markConverted(slug, plan).catch(() => {})
      // #464 — setAppPlan() above only stamps `enrolled` on the app-registry row;
      // nothing ever read that flag, so a Business+ company never actually landed
      // in the SEPARATE store (lib/build/loop-enrollment.ts) the nightly cron
      // (app/api/build/nightly-loop/route.ts → listEnrolled()) really iterates.
      // Bridge the two here: a real registry lookup for companyName/track, then a
      // real enrollCompany() call, so "Business+ auto-enrolls" is actually true.
      // Guarded by isEnrolled() first — this route is explicitly documented as
      // safe to call repeatedly for the same checkout (page refresh, retry), and
      // enrollCompany() itself just appends a row with no dedup, so an unguarded
      // call here would double- (or N-times-) enroll the company, making the
      // nightly loop process it more than once per run. Best-effort — must never
      // block or fail checkout confirmation.
      if (enrolled) {
        resolveApp(slug)
          .then(async (entry) => {
            if (!entry) return
            if (await isEnrolled(slug)) return
            const track = entry.track === 'company' ? 'company' : 'app'
            return enrollCompany({
              companyId: slug,
              companyName: entry.name || slug,
              track,
              ownerKey: entry.ownerEmail ? entry.ownerEmail.trim().toLowerCase() : undefined,
            })
          })
          .catch(() => {})
      }
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

    // #207 · Meta: report the PAID conversion via CAPI as a Purchase (server-side,
    // survives ad-blockers/ITP). Best-effort; full no-op unless Meta CAPI is
    // configured. event_id lets the browser Pixel Purchase event dedup against this.
    const purchaseEmail = (await auth().catch(() => null) as any)?.user?.email as string | undefined
    reportMetaConversion({
      eventName: 'Purchase',
      eventId: `purchase-${slug || 'anon'}-${sessionId}`,
      email: purchaseEmail,
      value: PLAN_VALUE[plan] ?? 49, currency: 'USD',
      fbc: fbcFromRequest(request), fbp: fbpFromRequest(request),
      clientIp: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
      custom: { slug: slug || undefined, plan, source: 'builder' },
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

    // #243/#389: provision the company's DEDICATED per-company Railway service,
    // deployed from the company's OWN Gitea repo content (#381's real mechanism —
    // `railway add` + `railway up`, NOT the old shared-image GraphQL flow, which
    // never worked for any real company: confirmed this session 0/67 companies in
    // the registry ever got a railwayServiceId, since RAILWAY_COMPANY_SOURCE_IMAGE/
    // _REPO were never configured). THIS IS THE PAID-ONLY TRIGGER — we are past the
    // `paid && plan` gate above, so this branch is only ever reached for a VERIFIED
    // PAID subscription, never a free/anonymous build.
    //
    // Cost-safe + idempotent:
    //  - Inert unless RAILWAY_DEPLOY_ENABLED is set (companyDeployEnabled()) — no
    //    Railway CLI call at all otherwise.
    //  - We read the registry FIRST and pass alreadyProvisioned = true when a
    //    railwayServiceId is already persisted, so a re-run of verify for an
    //    already-deployed company skips `railway add` and goes straight to
    //    `railway up` (a redeploy of current content, never a second billable
    //    service — mirrors deployCompanyApp()'s own idempotency contract).
    //  - A company with no Gitea repo yet is a normal, expected state
    //    (deployCompanyFromGitea returns {ok:false, reason:'no_repo'}), not an error.
    // Best-effort: a deploy failure must never fail checkout confirmation.
    let deployed: boolean | undefined
    if (slug && companyDeployEnabled()) {
      try {
        const entry = await resolveApp(slug).catch(() => null)
        if (entry?.chatId) {
          const alreadyProvisioned = Boolean(entry.railwayServiceId)
          const dep = await deployCompanyFromGitea(entry.workspaceId || BUILDER_WORKSPACE_ID, slug, alreadyProvisioned)
          if (dep.ok && dep.serviceName) {
            await setAppRailwayService(slug, {
              railwayServiceId: dep.serviceName,
              deployUrl: dep.url,
            }).catch(() => {})
            deployed = true
          }
        }
      } catch { /* best-effort — never block confirmation on deploy */ }
    }

    // #59 Refer & Earn: if THIS subscriber was referred by someone, credit the
    // referrer now (the reward moment is SUBSCRIBE, mirroring Polsia). Keyed by
    // the subscriber's durable owner key (= the referred_key on their pending
    // referral row). Uncapped, instant, idempotent (a re-run won't double-pay).
    // Best-effort + additive: it must NEVER disturb the conversion reporting
    // above or fail checkout confirmation.
    let referralCredited: number | undefined
    try {
      const referredKey = deriveOwnerKey((await auth().catch(() => null)) as any)
      if (referredKey && !referredKey.startsWith('guest:')) {
        const awarded = await creditReferrerOnSubscribe(referredKey, plan).catch(() => 0)
        if (awarded > 0) referralCredited = awarded
      }
    } catch { /* best-effort — never block confirmation on referral credit */ }

    return Response.json({ ok: true, paid: true, plan, planName, enrolled, claimed, deployed, referralCredited })
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e).slice(0, 100) }, { status: 502 })
  }
}
