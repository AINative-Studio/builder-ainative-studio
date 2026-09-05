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
 * must NEVER claim a confirmed "Connected" state.
 *
 * Pattern mirrors the sign-in-gated POST + window.open shape already used by
 * `connect-domain` (see DomainModal.tsx's `connectByo`/`routeToAuthForByo`):
 * anonymous → route into sign-in (resuming isn't needed here since there's
 * nothing to "finish" but re-clicking); signed in → POST, then open the
 * returned authUrl in a new tab.
 */

import { useState } from 'react'

interface Props {
  companyId: string
  signedIn: boolean
  /** Persisted "founder clicked connect" timestamp from the app-registry entry (honest, unverified). */
  clickedAt?: string | null
  onRequireAuth: () => void
}

export function ZeroInvoiceConnect({ companyId, signedIn, clickedAt, onRequireAuth }: Props) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [clicked, setClicked] = useState<boolean>(!!clickedAt)

  const connect = async () => {
    if (busy) return
    if (!signedIn) { onRequireAuth(); return }
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/build/zeroinvoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: companyId }),
      })
      const data = await res.json().catch(() => null)
      if (data?.reason === 'signin') { onRequireAuth(); return }
      if (data?.ok && data.authUrl) {
        window.open(data.authUrl, '_blank', 'noopener,noreferrer')
        setClicked(true)
        return
      }
      setNotice(data?.reason || 'Could not reach ZeroInvoice — try again in a moment.')
    } catch {
      setNotice('Network error — try connecting again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="m-system m-system-static" data-testid="zeroinvoice-connect">
      <span className="m-system-name">ZeroInvoice</span>
      {/* Honest copy (#506): never "Connected" — builder structurally cannot
          verify the OAuth callback ZeroInvoice's own frontend owns. */}
      <span className="m-system-stat m-mono" data-testid="zeroinvoice-connect-status">
        {clicked ? 'Connect requested — finish in the new tab' : 'Not connected'}
      </span>
      <span className="m-chip m-system-prim">ZeroInvoice</span>
      <button
        className="btn-secondary"
        data-testid="zeroinvoice-connect-btn"
        onClick={connect}
        disabled={busy}
      >
        {busy ? 'Connecting…' : clicked ? 'Reconnect ZeroInvoice' : 'Connect ZeroInvoice'}
      </button>
      {notice && (
        <p className="m-mono m-metric-note" data-testid="zeroinvoice-connect-notice">{notice}</p>
      )}
    </div>
  )
}
