'use client'

/** Pricing (#226) — the Launch gate, framed as Cody's ask. 04-SCREENS Pricing. */

import { useBuild } from '@/contexts/build-context'

// Builder subscription tiers — the canonical AINative plan line (config/pricing.ts).
// Skip Starter/$5 ('Hobbyist'): its 100K tokens can't build+run a real company.
// The free sandbox preview at /build/{slug} is the no-card entry; the real
// Builder subscription starts at $49. Stripe price IDs are the live AINative ones.
const TIERS = [
  { id: 'pro', name: 'Pro', price: '$49', tagline: 'Build it for real.', plan: 'launch' as const, featured: true,
    priceId: 'price_1TGUVdDP3OaRv4TyMwk7nnp1',
    features: ['Cody builds your app + company', '1M tokens · 50K API · 10GB', 'Real generation (Claude Sonnet 4.5)', 'Custom domain available'] },
  { id: 'business', name: 'Business', price: '$149', tagline: 'Cody runs it 24/7.', plan: 'company' as const,
    priceId: 'price_1TGUVeDP3OaRv4TyaqQG6lVT',
    features: ['Everything in Pro', 'The nightly autonomous loop', 'Sales pipeline · invoicing · helpdesk · voice', '5M tokens · 150K API · 50GB'] },
  { id: 'enterprise', name: 'Enterprise', price: '$999', tagline: 'Full agent-swarm autonomy.', plan: 'company' as const,
    priceId: 'price_1Ti31LDP3OaRv4TytcjLbFPh',
    features: ['Everything in Business', 'Real agent swarm executes builds', '20M tokens · 200GB · SSO', 'Priority support'] },
]

export function Pricing() {
  const { state, dispatch } = useBuild()
  const choose = async (tier: (typeof TIERS)[number]) => {
    dispatch({ type: 'PICK_PLAN', plan: tier.plan })
    // Start a real Stripe checkout for the chosen tier. On success Stripe redirects
    // back; if checkout can't start (anon/unconfigured), fall through into the
    // build-out so the demo flow never dead-ends.
    try {
      const res = await fetch('/api/build/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId: tier.priceId, plan: tier.id, companyId: state.appSub }),
      })
      const d = await res.json()
      if (d?.url) { window.location.href = d.url; return }
    } catch { /* fall through */ }
    dispatch({ type: 'PICK_TRACK', track: 'company' })
  }
  return (
    <div className="modernist m-pricing" data-track={state.track}>
      <p className="m-cody-line"><span className="m-glyph">◇</span> Cody · your technical co-founder</p>
      <h1 className="m-h1">Your prototype works. Let&apos;s make it real.</h1>
      <p className="m-sub">
        I built {state.companyName || 'it'} for free — live at builder.ainative.studio/build/{state.appSub || 'your-app'}.
        To put it in front of real users and let me run the company around it, pick how far we go. You own 100%.
      </p>
      <p className="m-reassure m-mono">You own 100% of everything I build. Cancel anytime.</p>
      <div className="m-tiers m-seams" data-testid="pricing-tiers">
        {TIERS.map((t) => (
          <div key={t.id} className={`m-tier ${t.featured ? 'is-featured' : ''}`} data-testid={`tier-${t.id}`}>
            <div className="m-tier-stripe" />
            <div className="m-tier-name m-mono">{t.name}</div>
            <div className="m-tier-price m-artifact">{t.price}<span>/mo</span></div>
            <p className="m-tier-tag">{t.tagline}</p>
            <ul className="m-list m-checks m-tier-features">{t.features.map((f) => <li key={f}>{f}</li>)}</ul>
            <button className={t.featured ? 'btn-primary' : 'btn-secondary'} data-testid={`choose-${t.id}`} onClick={() => choose(t)}>
              Choose {t.name}
            </button>
          </div>
        ))}
      </div>
      <p className="m-reassure m-mono">Real domain · real database · you own 100% · no revenue share.</p>
    </div>
  )
}
