'use client'

/** Pricing (#226) — the Launch gate, framed as Cody's ask. 04-SCREENS Pricing. */

import { useEffect, useState } from 'react'
import { useBuild } from '@/contexts/build-context'
import { trackEvent } from '@/components/analytics/google-analytics'
import { trackMeta } from '@/components/analytics/meta-pixel'
import { ProposalGate } from '@/components/build/ProposalGate'
import { pricingFraming } from '@/lib/build/value-moment'
import type { ArtifactView } from '@/lib/build/state'

// Builder subscription tiers — the canonical AINative plan line (config/pricing.ts).
// The free sandbox preview at /build/{slug} is the no-card entry (3 builds; see
// build-credits.ts). Starter ($20) is the price-sensitive entry ABOVE free: enough
// Haiku builds (1000 requests ≈ ~80 idea→prototype builds) to iterate before Pro's
// real Sonnet generation at $49. Stripe price IDs are the live AINative ones.
//
// NOTE on the name: "Hobbyist" is the INTERNAL name of the free/entry tier
// (lib/ainative/plan.ts normalizeTier maps free/basic→hobbyist). "starter" is now a
// DISTINCT $20 tier end-to-end: core PR #6617 (merged) split it from Hobbyist across
// the billing stack, and Builder's normalizeTier maps starter→starter to match.
//
// Yearly billing (#258): annual price = 10× monthly (2 months free), matching the
// Polsia parity gap. The live Stripe *monthly* price IDs are set; yearly price IDs
// don't exist in Stripe yet, so `priceIdYearly` is a clearly-marked TODO. Until those
// are created, the Yearly toggle shows the annual price but checkout stays on the
// monthly price ID (billed monthly, note shown) rather than inventing a fake ID.
const TIERS = [
  { id: 'starter', name: 'Starter', monthly: 20, tagline: 'Iterate on your idea.', plan: 'launch' as const,
    priceId: 'price_1U8TOwDP3OaRv4TyeJfzIRd4', // live $20/mo AINative Starter (core#6615 / core PR #6617)
    priceIdYearly: '', // TODO(#258): create Stripe yearly price ($200/yr) and set its price_… here
    features: ['~80 builds/mo (1000 requests)', 'Fast generation (Claude Haiku 4.5)', 'Shareable live URL', 'AINative primitives included'] },
  { id: 'pro', name: 'Pro', monthly: 49, tagline: 'Build it for real.', plan: 'launch' as const, featured: true,
    priceId: 'price_1TGUVdDP3OaRv4TyMwk7nnp1',
    priceIdYearly: '', // TODO(#258): create Stripe yearly price ($490/yr) and set its price_… here
    features: ['Cody builds your app + company', '1M tokens · 50K API · 10GB', 'Real generation (Claude Sonnet 4.5)', 'Custom domain available'] },
  { id: 'business', name: 'Business', monthly: 149, tagline: 'Cody runs it 24/7.', plan: 'company' as const,
    priceId: 'price_1TGUVeDP3OaRv4TyaqQG6lVT',
    priceIdYearly: '', // TODO(#258): create Stripe yearly price ($1,490/yr) and set its price_… here
    features: ['Everything in Pro', 'The nightly autonomous loop', 'Sales pipeline · invoicing · helpdesk · voice', '5M tokens · 150K API · 50GB'] },
  { id: 'enterprise', name: 'Enterprise', monthly: 999, tagline: 'Full agent-swarm autonomy.', plan: 'company' as const,
    priceId: 'price_1Ti31LDP3OaRv4TytcjLbFPh',
    priceIdYearly: '', // TODO(#258): create Stripe yearly price ($9,990/yr) and set its price_… here
    features: ['Everything in Business', 'Real agent swarm executes builds', '20M tokens · 200GB · SSO', 'Priority support'] },
]

// Yearly = 10× monthly (2 months free). Kept as a constant so the discount copy and
// the annual price stay in lockstep if the multiplier ever changes.
const YEARLY_MULTIPLIER = 10

// True once real yearly Stripe price IDs exist on every tier (see priceIdYearly TODOs).
// Until then, Yearly still shows the annual price but bills on the monthly ID.
const YEARLY_CHECKOUT_LIVE = TIERS.every((t) => !!t.priceIdYearly)

export function Pricing() {
  const { state, dispatch } = useBuild()
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly')
  const isYearly = period === 'yearly'
  // Ecosystem runway (#324 GR-15): read the SERVER-enforced credit status so the
  // wall honestly reflects any extra free builds earned by composing AINative
  // primitives. Best-effort — the wall renders the same without it.
  const [runway, setRunway] = useState<{ ecosystemBonus: number; limit: number; baseLimit: number } | null>(null)
  useEffect(() => {
    let on = true
    fetch('/api/build/credits')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (on && d && typeof d.ecosystemBonus === 'number' && d.ecosystemBonus > 0 && d.limit > 0) {
          setRunway({ ecosystemBonus: d.ecosystemBonus, limit: d.limit, baseLimit: d.baseLimit })
        }
      })
      .catch(() => { /* silent — copy line only */ })
    return () => { on = false }
  }, [])
  // Existing-subscriber recognition (#251) — the same hydration Live runs. An
  // AINative Enterprise/paid founder reaching Pricing must be RECOGNIZED, not
  // pitched plans they already have (their plan limits govern Builder usage).
  useEffect(() => {
    if (state.activePlan) return
    fetch('/api/build/subscription/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.plan) dispatch({ type: 'SET_ACTIVE_PLAN', plan: d.plan }) })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activePlan])

  // The tier the proposal cost line points at (#68) — the featured/recommended
  // plan, falling back to the first tier so the proposal always has a price.
  const featuredTier = TIERS.find((t) => t.featured) ?? TIERS[0]
  const onPlanLabel: Record<string, string> = {
    pro: 'Pro', business: 'Business', enterprise: 'Enterprise', cody_vcto: 'Cody · Virtual CTO',
  }
  const alreadyCovered = Boolean(state.activePlan)

  const choose = async (tier: (typeof TIERS)[number]) => {
    dispatch({ type: 'PICK_PLAN', plan: tier.plan })
    // GA4 funnel step 5 — checkout started (tier chosen → heading to Stripe). Value
    // is the monthly price so GA4/Ads can weight begin_checkout by plan.
    trackEvent('checkout_started', 'funnel', `${tier.id}_${isYearly ? 'yearly' : 'monthly'}`, isYearly ? tier.monthly * 10 : tier.monthly)
    // Meta Pixel InitiateCheckout (mirrors GA4 checkout_started). No-op if the pixel
    // isn't configured. Purchase (not this) is the server-CAPI-deduped conversion.
    trackMeta('InitiateCheckout', {
      value: isYearly ? tier.monthly * 10 : tier.monthly,
      currency: 'USD',
      content_name: `${tier.id}_${isYearly ? 'yearly' : 'monthly'}`,
    })
    // Use the yearly price ID only when one actually exists; otherwise fall back to the
    // monthly ID so we never send a fake/unset price to Stripe (checkout would 400).
    const priceId = isYearly && tier.priceIdYearly ? tier.priceIdYearly : tier.priceId
    // Start a real Stripe checkout for the chosen tier. On success Stripe redirects
    // back; if checkout can't start (anon/unconfigured), fall through into the
    // build-out so the demo flow never dead-ends.
    try {
      const res = await fetch('/api/build/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId, plan: tier.id, companyId: state.appSub }),
      })
      const d = await res.json()
      if (d?.url) { window.location.href = d.url; return }
    } catch { /* fall through */ }
    dispatch({ type: 'PICK_TRACK', track: 'company' })
  }

  // Back to the Live dashboard — no dead-end (#282).
  const backToLive = () => dispatch({ type: 'GOTO_SCREEN', screen: 'live' })
  const backLabel = state.companyName ? `‹ Back to ${state.companyName}` : '‹ Back'

  // Honest framing (#310/#311 GR-01/GR-02): "your prototype works" is only
  // claimable once the founder has actually SEEN a working preview. Before the
  // value moment the screen offers the preview first — never a card ask that
  // pretends value was already delivered. Pure logic in lib/build/value-moment.
  const framing = pricingFraming({
    sawPreview: state.sawPreview,
    companyName: state.companyName,
    appSub: state.appSub,
    hasBuild: Boolean(state.idea && state.appSub),
  })
  const seePreviewFirst = () => {
    dispatch({ type: 'GOTO_SCREEN', screen: 'ws' })
    dispatch({ type: 'GOTO_VIEW', view: 'preview' as ArtifactView })
  }

  return (
    <div className="modernist m-pricing" data-track={state.track}>
      {/* Escape hatch — the Pricing screen must never trap the user (#282). */}
      <button
        type="button"
        className="btn-ghost m-pricing-back"
        onClick={backToLive}
        aria-label="Return to company dashboard"
        data-testid="pricing-back"
      >
        {backLabel}
      </button>
      <p className="m-cody-line"><span className="m-glyph">◇</span> Cody · your technical co-founder</p>
      <h1 className="m-h1" data-testid="pricing-headline">{framing.headline}</h1>
      <p className="m-sub">{framing.sub}</p>
      {/* Value-before-card escape (#310/#311): if the founder landed here without
          ever seeing their working preview, the primary path is BACK to it. */}
      {framing.showSeePreviewFirst && (
        <button
          type="button"
          className="btn-primary"
          data-testid="pricing-see-preview-first"
          onClick={seePreviewFirst}
        >
          See your app first →
        </button>
      )}
      <p className="m-reassure m-mono">You own 100% of everything I build. Cancel anytime.</p>
      {/* #324 GR-15 — honest runway line: only shown when the server says a bonus applied. */}
      {runway && (
        <p className="m-cody-line" data-testid="ecosystem-runway-pricing">
          <span className="m-glyph">◇</span> Your builds composed AINative primitives — I extended your free
          runway from {runway.baseLimit} to {runway.limit} builds.
        </p>
      )}

      {/* Designed proposal (#68) — the #1 conversion lever: the real app preview +
          the business systems Cody wires (each with "what it does" + click-to-preview)
          + a clear cost line, presented BEFORE the tiers so the founder experiences
          the plan (mid-journey) rather than being cold-sold. Spotlights the featured
          tier for the cost line; the tiers below own checkout. */}
      <ProposalGate plan={{ id: featuredTier.id, name: featuredTier.name, monthly: featuredTier.monthly }} />

      {/* Existing-subscriber recognition (#251): a founder already on an AINative
          paid plan (Pro/Business/Enterprise) is COVERED — never pitch them tiers
          they already have. Their plan limits govern Builder usage. */}
      {alreadyCovered && (
        <div className="m-cody-banner" data-testid="pricing-on-plan">
          <p>
            <span className="m-glyph">◇</span> You&apos;re on the AINative{' '}
            <strong>{onPlanLabel[state.activePlan] || state.activePlan}</strong> plan — Builder is
            covered by your existing plan limits. No new subscription needed.
          </p>
          <button className="btn-primary" data-testid="pricing-keep-building" onClick={backToLive}>
            Keep building →
          </button>
        </div>
      )}

      {!alreadyCovered && (<>
      <div className="m-billing-toggle" data-testid="billing-toggle">
        <div className="m-billing-switch" role="group" aria-label="Billing period">
          <button
            type="button"
            className={!isYearly ? 'is-active' : ''}
            aria-pressed={!isYearly}
            data-testid="billing-monthly"
            onClick={() => setPeriod('monthly')}
          >
            Monthly
          </button>
          <button
            type="button"
            className={isYearly ? 'is-active' : ''}
            aria-pressed={isYearly}
            data-testid="billing-yearly"
            onClick={() => setPeriod('yearly')}
          >
            Yearly
          </button>
        </div>
        <span className="m-chip">2 months free</span>
      </div>
      <div className="m-tiers m-seams" data-testid="pricing-tiers">
        {TIERS.map((t) => {
          const amount = isYearly ? t.monthly * YEARLY_MULTIPLIER : t.monthly
          return (
            <div key={t.id} className={`m-tier ${t.featured ? 'is-featured' : ''}`} data-testid={`tier-${t.id}`}>
              <div className="m-tier-stripe" />
              <div className="m-tier-name m-mono">{t.name}</div>
              <div className="m-tier-price m-artifact" data-testid={`price-${t.id}`}>
                ${amount.toLocaleString()}<span>{isYearly ? '/yr' : '/mo'}</span>
              </div>
              <p className="m-tier-save">{isYearly ? `2 months free · $${t.monthly.toLocaleString()}/mo billed annually` : ' '}</p>
              <p className="m-tier-tag">{t.tagline}</p>
              <ul className="m-list m-checks m-tier-features">{t.features.map((f) => <li key={f}>{f}</li>)}</ul>
              <button className={t.featured ? 'btn-primary' : 'btn-secondary'} data-testid={`choose-${t.id}`} onClick={() => choose(t)}>
                Choose {t.name}
              </button>
            </div>
          )
        })}
      </div>
      {isYearly && !YEARLY_CHECKOUT_LIVE && (
        <p className="m-billing-note" data-testid="yearly-billing-note">
          Annual pricing shown. Annual billing is coming soon — for now you&apos;ll be billed monthly and can switch to
          yearly once it&apos;s live.
        </p>
      )}
      </>)}
      <p className="m-reassure m-mono">Real domain · real database · you own 100% · no revenue share.</p>
    </div>
  )
}
