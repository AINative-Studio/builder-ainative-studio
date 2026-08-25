'use client'

/** Pricing (#226) — the Launch gate, framed as Cody's ask. 04-SCREENS Pricing. */

import { useState } from 'react'
import { useBuild } from '@/contexts/build-context'
import { trackEvent } from '@/components/analytics/google-analytics'
import { trackMeta } from '@/components/analytics/meta-pixel'
import { ProposalGate } from '@/components/build/ProposalGate'

// Builder subscription tiers — the canonical AINative plan line (config/pricing.ts).
// Skip Starter/$5 ('Hobbyist'): its 100K tokens can't build+run a real company.
// The free sandbox preview at /build/{slug} is the no-card entry; the real
// Builder subscription starts at $49. Stripe price IDs are the live AINative ones.
//
// Yearly billing (#258): annual price = 10× monthly (2 months free), matching the
// Polsia parity gap. The live Stripe *monthly* price IDs are set; yearly price IDs
// don't exist in Stripe yet, so `priceIdYearly` is a clearly-marked TODO. Until those
// are created, the Yearly toggle shows the annual price but checkout stays on the
// monthly price ID (billed monthly, note shown) rather than inventing a fake ID.
const TIERS = [
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
  // The tier the proposal cost line points at (#68) — the featured/recommended
  // plan, falling back to the first tier so the proposal always has a price.
  const featuredTier = TIERS.find((t) => t.featured) ?? TIERS[0]

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
      <h1 className="m-h1">Your prototype works. Let&apos;s make it real.</h1>
      <p className="m-sub">
        I built {state.companyName || 'it'} for free — live at builder.ainative.studio/build/{state.appSub || 'your-app'}.
        To put it in front of real users and let me run the company around it, pick how far we go. You own 100%.
      </p>
      <p className="m-reassure m-mono">You own 100% of everything I build. Cancel anytime.</p>

      {/* Designed proposal (#68) — the #1 conversion lever: the real app preview +
          the business systems Cody wires (each with "what it does" + click-to-preview)
          + a clear cost line, presented BEFORE the tiers so the founder experiences
          the plan (mid-journey) rather than being cold-sold. Spotlights the featured
          tier for the cost line; the tiers below own checkout. */}
      <ProposalGate plan={{ id: featuredTier.id, name: featuredTier.name, monthly: featuredTier.monthly }} />

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
      <p className="m-reassure m-mono">Real domain · real database · you own 100% · no revenue share.</p>
    </div>
  )
}
