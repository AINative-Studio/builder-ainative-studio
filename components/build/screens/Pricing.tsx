'use client'

/** Pricing (#226) — the Launch gate, framed as Cody's ask. 04-SCREENS Pricing. */

import { useBuild } from '@/contexts/build-context'

const TIERS = [
  { id: 'free', name: 'Free', price: '$0', tagline: 'Prototype in the sandbox.', plan: '' as const,
    features: ['Sandbox staging URL', 'One project', 'Community support'] },
  { id: 'pro', name: 'Pro', price: '$49', tagline: 'Put it in front of real users.', plan: 'launch' as const, featured: true,
    features: ['Custom domain + production deploy', 'The nightly agent loop', 'ZeroDB + ZeroMemory included', 'Email support'] },
  { id: 'business', name: 'Business', price: '$199', tagline: 'Run the whole company.', plan: 'company' as const,
    features: ['Everything in Pro', 'Sales pipeline + auto-invoicing', 'Voice & SMS + helpdesk', 'Priority support'] },
]

export function Pricing() {
  const { state, dispatch } = useBuild()
  const choose = (plan: '' | 'launch' | 'company') => {
    dispatch({ type: 'PICK_PLAN', plan })
    if (plan === '') { dispatch({ type: 'GOTO_SCREEN', screen: 'ws' }); return }
    // paid → continue into Company Track build-out (or straight to Live if company already built)
    dispatch({ type: 'PICK_TRACK', track: 'company' })
  }
  return (
    <div className="modernist m-pricing" data-track={state.track}>
      <p className="m-cody-line"><span className="m-glyph">◇</span> Cody · your technical co-founder</p>
      <h1 className="m-h1">Your prototype works. Let&apos;s make it real.</h1>
      <p className="m-sub">
        I built the MVP for free in a sandbox at {state.appSub || 'your-app'}.ainative.studio. To put it in
        front of real users — and to build the company around it — pick how far we go. I keep working either way.
      </p>
      <p className="m-reassure m-mono">You own 100% of everything I build. Cancel anytime.</p>
      <div className="m-tiers m-seams">
        {TIERS.map((t) => (
          <div key={t.id} className={`m-tier ${t.featured ? 'is-featured' : ''}`}>
            <div className="m-tier-stripe" />
            <div className="m-tier-name m-mono">{t.name}</div>
            <div className="m-tier-price m-artifact">{t.price}<span>/mo</span></div>
            <p className="m-tier-tag">{t.tagline}</p>
            <ul className="m-list m-checks m-tier-features">{t.features.map((f) => <li key={f}>{f}</li>)}</ul>
            <button className={t.featured ? 'btn-primary' : 'btn-secondary'} onClick={() => choose(t.plan)}>
              {t.id === 'free' ? 'Stay on Free' : `Choose ${t.name}`}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
