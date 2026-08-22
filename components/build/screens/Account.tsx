'use client'

/**
 * Account (#227 · #251 · #253) — profile, plan, and management surface.
 *
 * Reads the signed-in founder's real identity + active plan (no hardcoded mock),
 * links to the "my companies" index and the real Stripe billing portal, so an
 * existing subscriber sees their true plan and can self-serve manage/cancel it
 * (not a dead /settings/billing route). Usage meters remain illustrative until a
 * real usage endpoint is wired (tracked separately).
 */

import { useState } from 'react'
import { useBuild } from '@/contexts/build-context'
import { useSession, signOut } from 'next-auth/react'
import { planUnlocks, type ActivePlan } from '@/lib/build/state'

const PLAN_LABEL: Record<ActivePlan, string> = {
  '': 'Free', pro: 'Pro', business: 'Business', enterprise: 'Enterprise', cody_vcto: 'Cody · Virtual CTO',
}

// Illustrative usage meters — real per-account usage endpoint is out of scope here.
const METERS = [
  { label: 'API credits', used: 3400, total: 10000, unit: '' },
  { label: 'LLM tokens', used: 1.2, total: 5, unit: 'M' },
  { label: 'Storage', used: 0.8, total: 5, unit: 'GB' },
  { label: 'MCP hours', used: 6, total: 40, unit: 'h' },
]

export function Account() {
  const { state, dispatch } = useBuild()
  const { data: session, status } = useSession()
  const signedIn = status === 'authenticated'
  const email = (session?.user?.email as string | undefined) || ''
  const name = (session?.user?.name as string | undefined) || (email ? email.split('@')[0] : 'Guest')
  const initials = (name || email || 'GU').slice(0, 2).toUpperCase()
  const activePlan = state.activePlan
  const gates = planUnlocks(activePlan)
  const [portalBusy, setPortalBusy] = useState(false)

  // Manage plan / billing — open the real Stripe customer portal (#253).
  const manageBilling = async () => {
    if (portalBusy) return
    setPortalBusy(true)
    try {
      const r = await fetch('/api/build/subscription/portal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnUrl: window.location.href }),
      })
      const d = await r.json().catch(() => null)
      if (d?.url) { window.location.href = d.url; return }
    } catch { /* fall through */ }
    setPortalBusy(false)
  }

  return (
    <div className="modernist m-account">
      <header className="m-account-head">
        <button className="m-back" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'ws' })}>← Back to app</button>
        <h1 className="m-artifact m-account-h">Account</h1>
        {signedIn
          ? <button className="btn-ghost" onClick={() => signOut()}>Sign out</button>
          : <button className="btn-ghost" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'login' })}>Log in</button>}
      </header>

      <section className="m-account-profile">
        <div className="m-avatar m-mono">{initials}</div>
        <div>
          <div className="m-profile-name">{name}</div>
          <div className="m-mono m-profile-email">{email || 'Not signed in'}</div>
        </div>
        <span className="m-chip m-profile-plan" data-testid="account-plan">{PLAN_LABEL[activePlan]}</span>
      </section>

      {/* Plan + management (#251/#253) — real plan, real self-serve billing. */}
      <section className="m-account-sec">
        <h2 className="m-mono m-account-sec-h">Plan &amp; billing</h2>
        <div className="m-sec-rows">
          <div className="m-sec-row">
            <span>Current plan</span>
            <span className="m-chip">{PLAN_LABEL[activePlan]}</span>
          </div>
          <div className="m-sec-row">
            <span>Unlocks</span>
            <span className="m-mono m-muted">
              {activePlan
                ? [gates.customDomain && 'custom domain', gates.nightlyLoop && 'nightly loop', gates.swarm && 'agent swarm'].filter(Boolean).join(' · ') || '—'
                : 'Upgrade to unlock custom domain, nightly loop, and the swarm.'}
            </span>
          </div>
          <div className="m-sec-row">
            <span>My companies</span>
            <button className="btn-ghost" data-testid="account-my-companies" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'companies' })}>View all →</button>
          </div>
          <div className="m-sec-row">
            <span>Billing</span>
            {activePlan
              ? <button className="btn-secondary" data-testid="account-manage-billing" disabled={portalBusy} onClick={manageBilling}>{portalBusy ? 'Opening…' : 'Manage plan / billing ↗'}</button>
              : <button className="btn-primary" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'pricing' })}>Upgrade →</button>}
          </div>
        </div>
      </section>

      <section className="m-account-sec">
        <h2 className="m-mono m-account-sec-h">Usage this month</h2>
        <div className="m-meters">
          {METERS.map((m) => (
            <div key={m.label} className="m-meter">
              <div className="m-meter-top"><span className="m-mono m-meter-l">{m.label}</span><span className="m-mono m-meter-v">{m.used}{m.unit} / {m.total}{m.unit}</span></div>
              <div className="m-meter-bar"><span style={{ width: `${(m.used / m.total) * 100}%` }} /></div>
            </div>
          ))}
        </div>
        <p className="m-mono m-meter-reset">Resets in 12 days</p>
      </section>

      <section className="m-account-sec">
        <h2 className="m-mono m-account-sec-h">Security</h2>
        <div className="m-sec-rows">
          <div className="m-sec-row"><span>Two-factor authentication</span><span className="st is-done">Enabled</span></div>
          <div className="m-sec-row"><span>Active sessions</span><button className="btn-ghost" onClick={() => signOut()}>Sign out all</button></div>
        </div>
      </section>
    </div>
  )
}
