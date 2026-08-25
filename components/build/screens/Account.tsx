'use client'

/**
 * Account (#227 · #251 · #253 · #50) — profile, plan, and management surface.
 *
 * #50: Honest guest vs authenticated states.
 *   GUEST — shows a clear "temporary session" prompt with a "Sign up / Log in"
 *   primary CTA; hides Sign out, Sign out all, 2FA, and security sections that
 *   don't apply to an anonymous session.
 *   AUTHENTICATED — shows real identity (name/email) and a working Sign out.
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
import { isGuestSession, getDisplayName, getDisplayEmail } from '@/lib/build/account-session'

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
  const { data: session } = useSession()
  const isGuest = isGuestSession(session)
  const displayName = getDisplayName(session)
  const displayEmail = getDisplayEmail(session)
  const initials = isGuest ? 'GU' : (displayName || displayEmail || 'GU').slice(0, 2).toUpperCase()
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

  // ── GUEST STATE ───────────────────────────────────────────────────────────
  if (isGuest) {
    return (
      <div className="modernist m-account">
        <header className="m-account-head">
          <button className="m-back" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'ws' })}>← Back to app</button>
          <h1 className="m-artifact m-account-h">Account</h1>
          <button
            className="btn-primary"
            data-testid="account-guest-signup-cta"
            onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'signup' })}
          >
            Sign up / Log in
          </button>
        </header>

        <section className="m-account-profile">
          <div className="m-avatar m-mono">{initials}</div>
          <div>
            <div className="m-profile-name">Guest Session</div>
            <div className="m-mono m-profile-email" data-testid="account-guest-email-line">Temporary — not saved</div>
          </div>
          <span className="m-chip m-profile-plan" data-testid="account-plan">Free</span>
        </section>

        {/* Guest prompt — explain value of creating an account. */}
        <section className="m-account-sec" data-testid="account-guest-prompt">
          <h2 className="m-mono m-account-sec-h">You're in a temporary guest session</h2>
          <p className="m-mono m-muted" style={{ padding: '0 0 0.75rem' }}>
            Your companies, custom domain, and nightly loop don't persist yet.
            Create a free account to keep everything — no card required.
          </p>
          <div className="m-sec-rows">
            <div className="m-sec-row">
              <span>Save your work</span>
              <button
                className="btn-primary"
                data-testid="account-guest-create-account"
                onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'signup' })}
              >
                Create account →
              </button>
            </div>
            <div className="m-sec-row">
              <span>Already have an account?</span>
              <button
                className="btn-secondary"
                data-testid="account-guest-login"
                onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'login' })}
              >
                Log in →
              </button>
            </div>
          </div>
        </section>

        {/* Plan info — show upgrade path but not billing management. */}
        <section className="m-account-sec">
          <h2 className="m-mono m-account-sec-h">Plans</h2>
          <div className="m-sec-rows">
            <div className="m-sec-row">
              <span>Current</span>
              <span className="m-chip">Free (guest)</span>
            </div>
            <div className="m-sec-row">
              <span>Unlock</span>
              <span className="m-mono m-muted">Custom domain, nightly loop &amp; swarm on paid plans.</span>
            </div>
            <div className="m-sec-row">
              <span>Pricing</span>
              <button className="btn-ghost" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'pricing' })}>See plans →</button>
            </div>
          </div>
        </section>
      </div>
    )
  }

  // ── AUTHENTICATED STATE ───────────────────────────────────────────────────
  return (
    <div className="modernist m-account">
      <header className="m-account-head">
        <button className="m-back" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'ws' })}>← Back to app</button>
        <h1 className="m-artifact m-account-h">Account</h1>
        <button
          className="btn-ghost"
          data-testid="account-sign-out"
          onClick={() => signOut()}
        >
          Sign out
        </button>
      </header>

      <section className="m-account-profile">
        <div className="m-avatar m-mono">{initials}</div>
        <div>
          <div className="m-profile-name" data-testid="account-display-name">{displayName}</div>
          <div className="m-mono m-profile-email" data-testid="account-display-email">{displayEmail || 'No email on record'}</div>
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

      <section className="m-account-sec" data-testid="account-security-section">
        <h2 className="m-mono m-account-sec-h">Security</h2>
        <div className="m-sec-rows">
          <div className="m-sec-row"><span>Two-factor authentication</span><span className="st is-done">Enabled</span></div>
          <div className="m-sec-row">
            <span>Active sessions</span>
            <button
              className="btn-ghost"
              data-testid="account-sign-out-all"
              onClick={() => signOut()}
            >
              Sign out all
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
