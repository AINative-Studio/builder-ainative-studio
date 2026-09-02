'use client'

/**
 * GrowthPanel (#449) — "Growth" section on the Live dashboard: fund a real,
 * automated Meta ad-test campaign for the company, review clicks/CPC once
 * it's running.
 *
 * The founder never touches Meta directly — builder uses AINative's OWN ad
 * account. They request a budget, pay the FULL amount via Stripe (proxied to
 * core, which owns the Stripe key), and only 80% of it is ever actually
 * submitted to Meta as the real spend — the 20% margin is captured
 * server-side, computed on core, never trusted from this component. The
 * campaign itself is created ONLY after core's webhook confirms the payment
 * (app/api/webhooks/ad-budget-confirmed) — this panel never creates a
 * campaign directly, it only ever kicks off the Stripe redirect and then
 * polls/displays whatever state the company's registry ends up in.
 *
 * Doubly gated server-side (GROWTH_AD_TESTING_ENABLED flag + a real Marketing
 * API credential) — this panel renders an honest disabled/unavailable state
 * rather than faking a working flow when either isn't configured.
 *
 * Chrome: reuses the same `.m-live-card`/`.st`/`.m-chip`/`.btn-*`/`.m-task-*`
 * classes AutoModePanel already established, so it matches the dashboard
 * without a new visual language.
 */

import { useCallback, useEffect, useState } from 'react'

interface Props {
  companyId: string
  companyName: string
  /** Whether the Growth module is unlocked on the current plan (paid tiers only). */
  unlocked: boolean
  onUpgrade: () => void
}

interface GrowthState {
  campaignId?: string
  fundedCents?: number
  realBudgetCents?: number
  clicks?: number
  cpcCents?: number
  insightsSyncedAt?: string
}

const PRESET_AMOUNTS_CENTS = [500, 1000, 2500, 5000] // $5 / $10 / $25 / $50

function formatCents(cents: number | undefined): string {
  if (!Number.isFinite(cents)) return '$0.00'
  return `$${((cents as number) / 100).toFixed(2)}`
}

export function GrowthPanel({ companyId, companyName, unlocked, onUpgrade }: Props) {
  const [loaded, setLoaded] = useState(false)
  const [available, setAvailable] = useState(true)
  const [state, setState] = useState<GrowthState>({})
  const [amountCents, setAmountCents] = useState<number>(1000)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    let alive = true
    fetch(`/api/build/growth/status?slug=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: any) => {
        if (!alive) return
        setAvailable(d?.available !== false)
        setState({
          campaignId: d?.campaignId,
          fundedCents: d?.fundedCents,
          realBudgetCents: d?.realBudgetCents,
          clicks: d?.clicks,
          cpcCents: d?.cpcCents,
          insightsSyncedAt: d?.insightsSyncedAt,
        })
        setLoaded(true)
      })
      .catch(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [companyId])

  useEffect(() => load(), [load])

  const fund = async () => {
    if (busy) return
    if (!unlocked) { onUpgrade(); return }
    setBusy(true); setNotice(null)
    try {
      const r = await fetch('/api/build/growth/ad-budget-checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: companyId, amountCents }),
      })
      const d = await r.json().catch(() => null)
      if (d?.ok && d.url) {
        window.location.href = d.url
        return
      }
      if (d?.reason === 'tier') { onUpgrade(); return }
      if (d?.reason === 'disabled') {
        setAvailable(false)
        setNotice('Growth isn’t available in this environment yet.')
      } else {
        setNotice('Could not start checkout — try again in a moment.')
      }
    } catch {
      setNotice('Could not start checkout — try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  const refreshInsights = async () => {
    if (busy || !state.campaignId) return
    setBusy(true)
    try {
      const r = await fetch('/api/build/growth/ad-insights', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: companyId }),
      })
      const d = await r.json().catch(() => null)
      if (d?.ok) {
        setState((s) => ({ ...s, clicks: d.clicks, cpcCents: d.cpcCents }))
      } else {
        setNotice('Could not refresh ad performance right now.')
      }
    } catch {
      setNotice('Could not refresh ad performance right now.')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return null

  return (
    <div className="m-live-card" data-testid="growth-panel">
      <div className="m-task-card-h">
        <span className="st">Growth</span>
        <span className="m-chip">Automated ad testing</span>
      </div>

      {!available ? (
        <p className="m-mono m-metric-note" data-testid="growth-disabled-note">
          Growth isn’t available in this environment yet. Nothing was faked — it’ll switch on
          once ad testing is configured.
        </p>
      ) : state.campaignId ? (
        // ---- FUNDED: campaign exists, show reporting ------------------------
        <div className="m-task-card" data-testid="growth-campaign-active">
          <p className="m-task-meta" data-testid="growth-campaign-status">
            Test campaign created for {companyName} — funded {formatCents(state.fundedCents)},
            real Meta budget {formatCents(state.realBudgetCents)}/day. Paused — review and launch it
            yourself in Meta Ads Manager when ready.
          </p>
          <div className="m-task-card-h">
            <span className="m-chip" data-testid="growth-clicks">
              {state.clicks ?? 0} click{state.clicks === 1 ? '' : 's'}
            </span>
            <span className="m-chip" data-testid="growth-cpc">
              {formatCents(state.cpcCents)} CPC
            </span>
          </div>
          <button className="btn-secondary" data-testid="growth-refresh-insights" onClick={refreshInsights} disabled={busy}>
            {busy ? 'Refreshing…' : 'Refresh performance'}
          </button>
        </div>
      ) : (
        // ---- IDLE: request a budget -----------------------------------------
        <div className="m-task-card" data-testid="growth-idle">
          <label className="m-mono m-metric-note" htmlFor="growth-amount-select">
            Fund a test campaign:
          </label>
          <div className="m-doc-tabs" role="radiogroup" aria-label="Ad budget amount" data-testid="growth-amounts">
            {PRESET_AMOUNTS_CENTS.map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={amountCents === c}
                className={`m-chip m-doc-tab${amountCents === c ? ' is-active' : ''}`}
                data-testid={`growth-amount-${c}`}
                onClick={() => setAmountCents(c)}
              >
                {formatCents(c)}
              </button>
            ))}
          </div>
          <select
            id="growth-amount-select"
            className="m-select"
            data-testid="growth-amount-select"
            value={amountCents}
            onChange={(e) => setAmountCents(Number(e.target.value))}
            style={{ display: 'none' }}
          >
            {PRESET_AMOUNTS_CENTS.map((c) => (
              <option key={c} value={c}>{formatCents(c)}</option>
            ))}
          </select>
          <p className="m-mono m-metric-note" data-testid="growth-cost">
            {unlocked ? 'included on your plan' : 'Paid plan required'}
          </p>
          <button className="btn-primary" data-testid="growth-fund" onClick={fund} disabled={busy}>
            {busy ? 'Starting checkout…' : unlocked ? 'FUND TEST CAMPAIGN' : 'FUND TEST CAMPAIGN ↗'}
          </button>
        </div>
      )}

      {notice && (
        <p className="m-mono m-ver-status" data-testid="growth-notice">{notice}</p>
      )}
    </div>
  )
}
