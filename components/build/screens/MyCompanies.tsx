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
  const { state, dispatch } = useBuild()
  const { status } = useSession()
  const signedIn = status === 'authenticated'
  // Delete affordance (#649) — the founder-facing gap this session's audit
  // found: the real soft-delete primitive (setAppLifecycle, resolveApp
  // already treats 'deleted' as a real 404) has existed since #57, but the
  // only UI control for it (DangerZone in Account.tsx) only ever acts on
  // whatever company happens to be "active" in the current client-side
  // reducer state — not reachable for a company the founder is just
  // browsing here. Reuses the same typed-confirmation pattern + the same
  // /api/build/danger endpoint (now ownership-checked server-side, #649).
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Existing-subscriber recognition (#251): hydrate the account plan so
  // companies without a per-company subscription carry the founder's real plan
  // chip instead of "Free" (Enterprise founders saw "Free" everywhere).
  useEffect(() => {
    if (!signedIn || state.activePlan) return
    fetch('/api/build/subscription/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.plan) dispatch({ type: 'SET_ACTIVE_PLAN', plan: d.plan }) })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, state.activePlan])

  // Real gap (customer-reported, 2026-09-09, Vamsi/Ledra+Pathlo+Voya — genuine
  // paying Enterprise accounts): every "Manage plan" link here unconditionally
  // opened Builder's own Stripe-portal proxy, which has no real customer to
  // manage for Enterprise (that billing is a contract/invoice relationship on
  // the AINative dashboard, not Stripe self-serve) — confirmed correct in
  // Account.tsx already for the staff-admin case, but never applied here nor
  // to real (non-staff) Enterprise subscribers. Enterprise → the real AINative
  // dashboard; everyone else → Builder's own upgrade/cancel portal.
  const isEnterpriseBilling = state.activePlan === 'enterprise'
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

  // Delete a company (#649). Requires the founder to type its exact name —
  // the same server-enforced guard DangerZone already uses. On success,
  // optimistically drops it from the local list (an honest state — the
  // registry entry really is soft-deleted, resolveApp will 404 it).
  const deleteCompany = async (c: Company) => {
    if (deleteBusy) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const r = await fetch('/api/build/danger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete', companyId: c.slug, companyName: c.name,
          slug: c.slug, track: c.track === 'app' ? 'app' : 'company',
          confirm: deleteConfirmText.trim(),
        }),
      })
      const d = await r.json().catch(() => null)
      if (r.ok && d?.ok) {
        setCompanies((prev) => (prev || []).filter((x) => x.slug !== c.slug))
        setDeleteTarget(null)
        setDeleteConfirmText('')
      } else {
        setDeleteError(
          d?.error === 'not_owner' ? 'You are not the owner of this company.' : (d?.error || 'Could not delete — please try again.'),
        )
      }
    } catch {
      setDeleteError('Could not delete — please try again.')
    } finally {
      setDeleteBusy(false)
    }
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
            {isEnterpriseBilling ? (
              <a className="btn-ghost" data-testid="manage-billing-ainative" href="https://ainative.studio/billing" target="_blank" rel="noopener noreferrer">
                Manage on ainative.studio ↗
              </a>
            ) : (
              <button className="btn-ghost" data-testid="manage-billing" disabled={portalBusy} onClick={manageBilling}>
                {portalBusy ? 'Opening…' : 'Manage plan / billing ↗'}
              </button>
            )}
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
                    ) : state.activePlan ? (
                      /* Account-level plan covers companies with no per-company
                         subscription — never label them "Free" for a paying
                         founder (Enterprise saw "Free" chips, 2026-08-27). */
                      <span className="m-chip m-profile-plan">{PLAN_LABEL[state.activePlan] || state.activePlan}</span>
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
                    {isEnterpriseBilling || c.plan === 'enterprise' ? (
                      <a className="btn-ghost" data-testid={`billing-${c.slug}`} href="https://ainative.studio/billing" target="_blank" rel="noopener noreferrer">Manage on ainative.studio ↗</a>
                    ) : (
                      <button className="btn-ghost" data-testid={`billing-${c.slug}`} disabled={portalBusy} onClick={manageBilling}>Manage plan ↗</button>
                    )}
                    <button
                      className="btn-ghost m-danger-link"
                      data-testid={`delete-${c.slug}`}
                      disabled={deleteBusy}
                      onClick={() => {
                        setDeleteTarget(deleteTarget === c.slug ? null : c.slug)
                        setDeleteConfirmText('')
                        setDeleteError(null)
                      }}
                    >
                      Delete
                    </button>
                  </div>

                  {deleteTarget === c.slug && (
                    <div className="m-danger-confirm" data-testid={`delete-confirm-${c.slug}`}>
                      <label className="m-field-l" htmlFor={`delete-confirm-input-${c.slug}`}>
                        Type <strong>{c.name}</strong> to delete it permanently
                      </label>
                      <input
                        id={`delete-confirm-input-${c.slug}`}
                        data-testid={`delete-confirm-input-${c.slug}`}
                        type="text"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        autoComplete="off"
                      />
                      <div className="m-settings-actions">
                        <button
                          className="btn-danger"
                          data-testid={`delete-confirm-submit-${c.slug}`}
                          disabled={deleteBusy || deleteConfirmText.trim().toLowerCase() !== c.name.trim().toLowerCase()}
                          onClick={() => deleteCompany(c)}
                        >
                          {deleteBusy ? 'Deleting…' : 'Delete permanently'}
                        </button>
                        <button
                          className="btn-ghost"
                          data-testid={`delete-confirm-cancel-${c.slug}`}
                          disabled={deleteBusy}
                          onClick={() => { setDeleteTarget(null); setDeleteConfirmText(''); setDeleteError(null) }}
                        >
                          Cancel
                        </button>
                      </div>
                      {deleteError && <p className="m-mono is-err" data-testid={`delete-error-${c.slug}`}>{deleteError}</p>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
