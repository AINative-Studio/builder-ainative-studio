'use client'

/**
 * ZeroInvoiceConnect (#506, child of #418) — "Connect ZeroInvoice" action on
 * the Live dashboard's business-systems section.
 *
 * The real backend (`POST /api/build/zeroinvoice`, `lib/build/zeroinvoice.ts`)
 * has existed and been live since #418 — this component is the ONLY missing
 * piece: a real, visible action that calls it. See those modules' doc
 * comments for the full architecture: ZeroInvoice owns its own OAuth 2.1 +
 * PKCE callback (exchanges the code, sets its own cookies, redirects to its
 * OWN dashboard) — builder never receives a token or confirmation. So this
 * component, like the route it calls, can only ever open the real authorize
 * URL for the founder and record an honest "clicked connect" signal — it
 * must NEVER claim a PLATFORM-verified "Connected" state.
 *
 * Pattern mirrors the sign-in-gated POST + window.open shape already used by
 * `connect-domain` (see DomainModal.tsx's `connectByo`/`routeToAuthForByo`):
 * anonymous → route into sign-in (resuming isn't needed here since there's
 * nothing to "finish" but re-clicking); signed in → POST, then open the
 * returned authUrl in a new tab.
 *
 * Real bug fix: after clicking Connect and finishing the OAuth flow in the
 * new tab, a founder had no way to tell builder they were done — the UI sat
 * at "Connect requested" forever, reading as stuck even when the founder's
 * side had genuinely succeeded. Re-confirmed live against ZeroInvoice's own
 * openapi.json: it has no status/webhook endpoint for its own AINative-
 * identity login (unlike its FreshBooks/QuickBooks/Xero integrations, which
 * each expose a real `/status` route) — so a real platform-verified check is
 * not possible. The honest fix is a founder SELF-confirmation, clearly
 * labeled as self-reported rather than platform-verified.
 */

import { useState } from 'react'

interface Props {
  companyId: string
  signedIn: boolean
  /** Persisted "founder clicked connect" timestamp from the app-registry entry (honest, unverified). */
  clickedAt?: string | null
  /** Persisted "founder confirmed they finished" timestamp (honest, self-reported). */
  confirmedAt?: string | null
  onRequireAuth: () => void
}

export function ZeroInvoiceConnect({ companyId, signedIn, clickedAt, confirmedAt, onRequireAuth }: Props) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [clicked, setClicked] = useState<boolean>(!!clickedAt)
  const [confirmed, setConfirmed] = useState<boolean>(!!confirmedAt)

  const connect = async () => {
    if (busy) return
    if (!signedIn) { onRequireAuth(); return }
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/build/zeroinvoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: companyId, action: 'authorize' }),
      })
      const data = await res.json().catch(() => null)
      if (data?.reason === 'signin') { onRequireAuth(); return }
      if (data?.ok && data.authUrl) {
        window.open(data.authUrl, '_blank', 'noopener,noreferrer')
        setClicked(true)
        setConfirmed(false)
        return
      }
      setNotice(data?.reason || 'Could not reach ZeroInvoice — try again in a moment.')
    } catch {
      setNotice('Network error — try connecting again.')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (busy) return
    if (!signedIn) { onRequireAuth(); return }
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/build/zeroinvoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: companyId, action: 'confirm' }),
      })
      const data = await res.json().catch(() => null)
      if (data?.reason === 'signin') { onRequireAuth(); return }
      if (data?.ok) { setConfirmed(true); return }
      setNotice('Could not save — try again in a moment.')
    } catch {
      setNotice('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  // Honest copy (#506): "Connected" here is always the FOUNDER'S OWN report,
  // never a platform-verified state — builder structurally cannot observe
  // the OAuth callback ZeroInvoice's own frontend owns.
  const statusLabel = confirmed
    ? '✓ Connected (self-reported)'
    : clicked
      ? 'Connect requested — finish in the new tab, then confirm below'
      : 'Not connected'

  return (
    <div className="m-system m-system-static" data-testid="zeroinvoice-connect">
      <span className="m-system-name">ZeroInvoice</span>
      <span className="m-system-stat m-mono" data-testid="zeroinvoice-connect-status">
        {statusLabel}
      </span>
      <span className="m-chip m-system-prim">ZeroInvoice</span>
      <button
        className="btn-secondary"
        data-testid="zeroinvoice-connect-btn"
        onClick={connect}
        disabled={busy}
      >
        {busy ? 'Connecting…' : confirmed || clicked ? 'Reconnect ZeroInvoice' : 'Connect ZeroInvoice'}
      </button>
      {clicked && !confirmed && (
        <button
          className="btn-primary"
          data-testid="zeroinvoice-confirm-btn"
          onClick={confirm}
          disabled={busy}
        >
          {busy ? 'Saving…' : "I've finished connecting"}
        </button>
      )}
      {notice && (
        <p className="m-mono m-metric-note" data-testid="zeroinvoice-connect-notice">{notice}</p>
      )}
    </div>
  )
}
