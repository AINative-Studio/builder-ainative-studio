'use client'

/**
 * My Companies (#253) — the access + management index for a founder's built
 * companies. A signed-in founder sees every company they built/claimed, opens its
 * Live dashboard again, manages plan/domain, and sees REAL ownership handles
 * (ZeroDB project id, custom domain, deploy URL) — beating Polsia's locked
 * black-box infra. Anonymous founders are routed to sign in.
 *
 * Consistent with the Modernist chrome (m-* classes) used by Account/Live.
 */

import { useEffect, useState } from 'react'
import { useBuild } from '@/contexts/build-context'
import { useSession } from 'next-auth/react'
import { migrateGuestWork } from '@/lib/build/guest-migration'
import { MenuChip } from '@/components/build/MenuChip'

interface Company {
  slug: string
  name: string
  tagline?: string
  color?: string | null
  track?: string
  plan?: string | null
  enrolled?: boolean
  zerodbProjectId?: string | null
  domain?: string | null
  deployUrl?: string
  keyKind?: string | null
  trialExpiresAt?: string | null
  liveUrl?: string
  createdAt?: string | null
}

const PLAN_LABEL: Record<string, string> = {
  pro: 'Pro', business: 'Business', enterprise: 'Enterprise', cody_vcto: 'Cody · Virtual CTO',
}

export function MyCompanies() {
  const { dispatch } = useBuild()
  const { status } = useSession()
  const signedIn = status === 'authenticated'
  const [companies, setCompanies] = useState<Company[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [portalBusy, setPortalBusy] = useState(false)

  useEffect(() => {
    if (status === 'loading') return
    if (!signedIn) { setLoading(false); return }
    let alive = true
    // Self-heal (#49 / missing-dashboard bug): claim any UNOWNED companies this
    // browser built (localStorage slugs → /api/build/migrate stamps the
    // server-verified session email) BEFORE listing, so builds made before
    // ownership stamping — or as a guest — surface here instead of vanishing.
    // Best-effort: a migration failure never blocks the list.
    migrateGuestWork()
      .catch(() => null)
      .then(() => fetch('/api/build/my-companies'))
      .then((r) => (r.ok ? r.json() : { companies: [] }))
      .then((d) => { if (alive) setCompanies(Array.isArray(d?.companies) ? d.companies : []) })
      .catch(() => { if (alive) setCompanies([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [signedIn, status])

  // Open a company's Live dashboard in-app (restores persisted build state via the
  // deep-link effect in build-context by round-tripping through the URL).
  const openLive = (c: Company) => {
    const url = new URL(window.location.href)
    url.searchParams.set('screen', 'live')
    url.searchParams.set('company', c.slug)
    window.location.href = url.toString()
  }

  // Manage plan/billing — open the real Stripe customer portal (#253).
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

  const trialHoursLeft = (iso?: string | null): number | null =>
    iso ? Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3.6e6)) : null

  return (
    <div className="modernist m-account">
      <header className="m-account-head">
        <button className="m-back" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'fork' })}>← Back</button>
        <h1 className="m-artifact m-account-h">My companies</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-secondary" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'fork' })}>+ New company</button>
          {/* Polsia-parity account MENU — present on every signed-in surface. */}
          <MenuChip />
        </div>
      </header>

      {!signedIn ? (
        <section className="m-account-sec" data-testid="companies-signin">
          <p className="m-live-card-body">Sign in to see the companies you&apos;ve built — pick any one back up, manage its plan and domain, on your own database.</p>
          <button className="btn-primary" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'login' })}>Log in →</button>
        </section>
      ) : loading ? (
        <section className="m-account-sec"><p className="m-mono m-muted">Loading your companies…</p></section>
      ) : !companies || companies.length === 0 ? (
        <section className="m-account-sec" data-testid="companies-empty">
          <p className="m-live-card-body">No companies yet. Build one and it&apos;ll show up here — yours to manage, on your own ZeroDB project and domain.</p>
          <button className="btn-primary" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'fork' })}>Build a company →</button>
        </section>
      ) : (
        <section className="m-account-sec">
          <div className="m-account-sec-h m-mono" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{companies.length} {companies.length === 1 ? 'company' : 'companies'}</span>
            <button className="btn-ghost" data-testid="manage-billing" disabled={portalBusy} onClick={manageBilling}>
              {portalBusy ? 'Opening…' : 'Manage plan / billing ↗'}
            </button>
          </div>
          <div className="m-companies" data-testid="companies-list">
            {companies.map((c) => {
              const paid = !!c.plan
              const trialLeft = c.keyKind === 'tmp' ? trialHoursLeft(c.trialExpiresAt) : null
              return (
                <div key={c.slug} className="m-live-card m-company-row" data-testid={`company-${c.slug}`}>
                  <div className="m-company-top">
                    <span className="m-avatar m-mono" style={c.color ? { background: c.color } : undefined}>
                      {(c.name || c.slug).slice(0, 2).toUpperCase()}
                    </span>
                    <div className="m-company-id">
                      <div className="m-profile-name">{c.name}</div>
                      {c.tagline ? <div className="m-mono m-muted m-company-tagline">{c.tagline}</div> : null}
                    </div>
                    {paid ? (
                      <span className="m-chip m-profile-plan">{PLAN_LABEL[c.plan!] || c.plan}</span>
                    ) : trialLeft != null ? (
                      <span className="m-chip">Trial · {trialLeft}h left</span>
                    ) : (
                      <span className="m-chip m-muted">Free</span>
                    )}
                  </div>

                  {/* Ownership handles — beat Polsia's locked black boxes (#253). */}
                  <div className="m-company-handles m-mono m-muted">
                    {c.domain ? (
                      <a className="m-handle" href={`https://${c.domain}`} target="_blank" rel="noreferrer">{c.domain} ↗</a>
                    ) : c.deployUrl ? (
                      <a className="m-handle" href={c.deployUrl} target="_blank" rel="noreferrer">{c.deployUrl.replace(/^https?:\/\//, '')} ↗</a>
                    ) : null}
                    {c.zerodbProjectId ? <span className="m-handle" title="Your ZeroDB project — you own it">db: {c.zerodbProjectId.slice(0, 12)}…</span> : null}
                    {c.keyKind === 'permanent' ? <span className="st is-done">owned</span> : null}
                  </div>

                  <div className="m-company-actions m-live-card-actions">
                    <button className="btn-primary" data-testid={`open-${c.slug}`} onClick={() => openLive(c)}>Open dashboard →</button>
                    {c.deployUrl ? (
                      <a className="btn-ghost" href={c.deployUrl} target="_blank" rel="noreferrer">View live site ↗</a>
                    ) : null}
                    <button className="btn-ghost" data-testid={`billing-${c.slug}`} disabled={portalBusy} onClick={manageBilling}>Manage plan ↗</button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
