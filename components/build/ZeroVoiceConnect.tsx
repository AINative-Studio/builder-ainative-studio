'use client'

/**
 * ZeroVoiceConnect (2026-09-16) — "Get a phone number" action on the Live
 * dashboard's Website & infrastructure card.
 *
 * Real gap this closes: `POST /api/build/zerovoice` (#415/#522/#777) has
 * been correctly built, tier-gated (any paid tier via isPaidTier — pro,
 * business, enterprise, cody_vcto, not enterprise-only), and wired to real
 * two-way SMS/voice conversation with Cody (#744 follow-up) for a while —
 * but NOTHING in the dashboard ever called it. A paying founder had no
 * visible way to provision a number at all. This component is that missing
 * button, mirroring ZeroInvoiceConnect's sign-in-gated POST pattern, but
 * simpler: unlike ZeroInvoice's OAuth handoff, this route is synchronous and
 * returns the real provisioned number directly — no "confirm you finished"
 * step needed.
 *
 * Cost honesty: ZeroVoice numbers carry a real, non-trivial recurring cost
 * (~$1.15/month + usage), so the button says so up front rather than
 * hiding it behind a vague "connect" label.
 */

import { useState } from 'react'

interface Props {
  companyId: string
  signedIn: boolean
  isPaidPlan: boolean
  /** Already-provisioned number, if any (from the company registry). */
  e164?: string | null
  onRequireAuth: () => void
}

export function ZeroVoiceConnect({ companyId, signedIn, isPaidPlan, e164, onRequireAuth }: Props) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [number, setNumber] = useState<string | null>(e164 || null)

  const provision = async () => {
    if (busy || number) return
    if (!signedIn) { onRequireAuth(); return }
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/build/zerovoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: companyId }),
      })
      const data = await res.json().catch(() => null)
      if (data?.reason === 'signin') { onRequireAuth(); return }
      if (data?.ok && data.e164) {
        setNumber(data.e164)
        return
      }
      if (data?.reason === 'disabled') {
        setNotice('Phone numbers are not enabled in this environment yet.')
      } else if (data?.reason === 'tier') {
        setNotice(data.unverified
          ? "Couldn't verify your plan just now — try again in a moment."
          : 'Upgrade to a paid plan to get a phone number for Cody.')
      } else {
        setNotice(data?.reason || 'Could not provision a number — try again in a moment.')
      }
    } catch {
      setNotice('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="m-system m-system-static" data-testid="zerovoice-connect">
      <span className="m-system-name">ZeroVoice</span>
      <span className="m-system-stat m-mono" data-testid="zerovoice-connect-status">
        {number ? `✓ ${number} — text or call Cody directly` : 'No phone number yet'}
      </span>
      <span className="m-chip m-system-prim">ZeroVoice</span>
      {!number && (
        <button
          className="btn-secondary"
          data-testid="zerovoice-connect-btn"
          onClick={provision}
          disabled={busy || !isPaidPlan}
          title={isPaidPlan ? 'Get a real phone number — Cody answers texts and calls directly (~$1.15/mo + usage)' : 'Upgrade to a paid plan to get a phone number for Cody'}
        >
          {busy ? 'Getting a number…' : 'Get a phone number (~$1.15/mo)'}
        </button>
      )}
      {notice && (
        <p className="m-mono m-metric-note" data-testid="zerovoice-connect-notice">{notice}</p>
      )}
    </div>
  )
}
