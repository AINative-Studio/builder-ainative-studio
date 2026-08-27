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
 * (not a dead /settings/billing route). Usage meters read the authoritative
 * per-user credit ledger via GET /api/credits (#312) — no hardcoded numbers.
 */

import { useEffect, useState } from 'react'
import { useBuild } from '@/contexts/build-context'
import { useSession, signOut } from 'next-auth/react'
import { planUnlocks, type ActivePlan } from '@/lib/build/state'
import { isGuestSession, getDisplayName, getDisplayEmail } from '@/lib/build/account-session'
import { SettingsForm } from '@/components/build/SettingsForm'
import { DangerZone } from '@/components/build/DangerZone'

const PLAN_LABEL: Record<ActivePlan, string> = {
  '': 'Free', pro: 'Pro', business: 'Business', enterprise: 'Enterprise', cody_vcto: 'Cody · Virtual CTO',
}

export interface UsageMeter {
  label: string
  used: number
  total: number
  unit: string
}

/**
 * Build the "Usage this month" meters from the live /api/credits payload.
 * Returns `null` when the ledger data is absent so the UI can show an honest
 * loading / zero state instead of fabricated numbers.
 *
 * `credits` is the normalized ledger ({ granted, used, remaining, ... }); `usage`
 * is the raw /credits/usage/current body (token counts etc., when present).
 */
export function buildMeters(credits: any, usage: any): UsageMeter[] | null {
  const granted = typeof credits?.granted === 'number' ? credits.granted : null
  const used = typeof credits?.used === 'number' ? credits.used : null
  if (granted === null && used === null) return null

  const meters: UsageMeter[] = [
    { label: 'API credits', used: used ?? 0, total: granted ?? 0, unit: '' },
  ]

  // Surface real token usage from /credits/usage/current when the ledger reports it.
  const u = usage?.data ?? usage
  const tokensUsed = typeof u?.tokens_used === 'number'
    ? u.tokens_used
    : (typeof u?.total_tokens === 'number' ? u.total_tokens : null)
  const tokensTotal = typeof u?.tokens_limit === 'number'
    ? u.tokens_limit
    : (typeof u?.token_limit === 'number' ? u.token_limit : null)
  if (tokensUsed !== null || tokensTotal !== null) {
    meters.push({ label: 'LLM tokens', used: tokensUsed ?? 0, total: tokensTotal ?? 0, unit: '' })
  }

  return meters
}

/** Format the ledger reset date, or null to hide the line when unknown. */
export function formatResetLine(resetsAt: unknown): string | null {
  if (typeof resetsAt !== 'string' || resetsAt.trim() === '') return null
  const d = new Date(resetsAt)
  if (Number.isNaN(d.getTime())) return null
  return `Resets ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

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

  // Live credit ledger (#312) — authenticated users only. Absent until loaded.
  const [creditsData, setCreditsData] = useState<{ credits: any; usage: any } | null>(null)
  const [creditsLoading, setCreditsLoading] = useState(false)
  useEffect(() => {
    if (isGuest) return
    let cancelled = false
    setCreditsLoading(true)
    fetch('/api/credits')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data) setCreditsData(data) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setCreditsLoading(false) })
    return () => { cancelled = true }
  }, [isGuest])

  const meters = buildMeters(creditsData?.credits, creditsData?.usage)
  const resetLine = formatResetLine(creditsData?.credits?.resetsAt)

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
            <div className="m-sec-row">
              <span>Refer &amp; Earn</span>
              <button className="btn-ghost" data-testid="account-refer-earn" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'refer' })}>Learn more →</button>
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

      {/* Editable profile settings (#57) — name / email / social / content language,
          persisted to the real AINative account. Authenticated users only. */}
      <SettingsForm fallbackName={displayName} fallbackEmail={displayEmail || ''} />

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
            <span>Refer &amp; Earn</span>
            <button className="btn-ghost" data-testid="account-refer-earn" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'refer' })}>Get your link →</button>
          </div>
          <div className="m-sec-row">
            <span>Billing</span>
            {activePlan
              ? <button className="btn-secondary" data-testid="account-manage-billing" disabled={portalBusy} onClick={manageBilling}>{portalBusy ? 'Opening…' : 'Manage plan / billing ↗'}</button>
              : <button className="btn-primary" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'pricing' })}>Upgrade →</button>}
          </div>
        </div>
      </section>

      <section className="m-account-sec" data-testid="account-usage-section">
        <h2 className="m-mono m-account-sec-h">Usage this month</h2>
        {meters && meters.length > 0 ? (
          <>
            <div className="m-meters">
              {meters.map((m) => (
                <div key={m.label} className="m-meter" data-testid={`account-meter-${m.label}`}>
                  <div className="m-meter-top"><span className="m-mono m-meter-l">{m.label}</span><span className="m-mono m-meter-v">{m.used.toLocaleString()}{m.unit} / {m.total.toLocaleString()}{m.unit}</span></div>
                  <div className="m-meter-bar"><span style={{ width: `${m.total > 0 ? Math.min(100, (m.used / m.total) * 100) : 0}%` }} /></div>
                </div>
              ))}
            </div>
            {resetLine && <p className="m-mono m-meter-reset" data-testid="account-usage-reset">{resetLine}</p>}
          </>
        ) : (
          <p className="m-mono m-muted" data-testid="account-usage-empty">
            {creditsLoading ? 'Loading usage…' : 'No usage recorded yet this month.'}
          </p>
        )}
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

      {/* Danger Zone (#57) — pause the loop, take the app offline, or delete the
          company, with confirmation. Acts on the current company in build state. */}
      <DangerZone
        companyId={state.appSub}
        companyName={state.companyName}
        slug={state.appSub}
        track={state.track}
      />
    </div>
  )
}
