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
 *
 * PAID-GATE FIX (real, live bug — a real founder on a real paid plan saw a
 * permanently-disabled button here): this used to also disable the button
 * client-side via an `isPaidPlan` prop derived from Live.tsx's own
 * `state.activePlan`. That client state can be genuinely stale/unhydrated
 * for a real paying founder for reasons that have nothing to do with their
 * actual entitlement (a slow/failed subscription/status fetch, a fresh
 * session, a race on first load) — the SERVER route already does the real,
 * authoritative tier check (core's own /auth/me, live, every request) and
 * returns an honest `reason: 'tier'` rejection with a clear message when it
 * genuinely fails. Gating the button on a second, less reliable client-side
 * copy of that same check can ONLY ever produce a false negative (a paid
 * founder blocked) — it can never correctly block someone the server would
 * have let through anyway, since the server re-checks regardless. Removed
 * the client-side gate entirely; the real tier check happens exactly once,
 * server-side, on every click.
 *
 * SMS CONSENT DISCLOSURE (ZeroVoice#626 follow-up): the public
 * zerovoice-frontend `/sms-terms` page describes opt-in as happening at
 * THIS exact moment — clicking "Get a phone number" — but until now that
 * moment carried no visible disclosure text of its own, only the number's
 * cost. A carrier reviewer verifying the A2P 10DLC campaign's `message_flow`
 * has no way to confirm the described in-product opt-in actually exists
 * without logging into a real account, and Twilio's compliance review
 * rejected the campaign twice on exactly this ("unverifiable Call to
 * Action," error 30909) even after `/sms-terms` itself was solid. Added the
 * real disclosure text directly here, at the real point of consent, so it
 * matches what `/sms-terms` describes and is visible to anyone who reaches
 * this screen (a paid founder), not just describable from outside it.
 */

import { useState } from 'react'

interface Props {
  companyId: string
  signedIn: boolean
  /** Already-provisioned number, if any (from the company registry). */
  e164?: string | null
  onRequireAuth: () => void
}

export function ZeroVoiceConnect({ companyId, signedIn, e164, onRequireAuth }: Props) {
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
        <>
          <button
            className="btn-secondary"
            data-testid="zerovoice-connect-btn"
            onClick={provision}
            disabled={busy}
            title="Get a real phone number — Cody answers texts and calls directly (~$1.15/mo + usage)"
          >
            {busy ? 'Getting a number…' : 'Get a phone number (~$1.15/mo)'}
          </button>
          <p className="m-mono m-metric-note" data-testid="zerovoice-sms-consent">
            By requesting a number, you agree to receive SMS replies from Cody at that number.
            Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help. See{' '}
            <a href="https://zerovoice-frontend-production.up.railway.app/sms-terms" target="_blank" rel="noreferrer">
              SMS Program Terms
            </a>.
          </p>
        </>
      )}
      {notice && (
        <p className="m-mono m-metric-note" data-testid="zerovoice-connect-notice">{notice}</p>
      )}
    </div>
  )
}
