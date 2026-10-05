'use client'

/**
 * TextCodyCard (#936) — surfaces AINative's shared, already-wired
 * Text-Cody number on the dashboard. Unlike ZeroVoiceConnect (which
 * provisions a NEW, company-owned number), there is nothing to provision
 * here — the shared number already exists and is already wired
 * (app/api/webhooks/zerovoice-sms/route.ts's shared-number branch). This is
 * purely informational, matching ZeroVoiceConnect's own no-client-tier-gate
 * pattern (the real tier check happens server-side, on the inbound SMS
 * itself, in lib/build/shared-cody-number.ts).
 */

const SHARED_NUMBER_DISPLAY = '(937) 764-2838'

export function TextCodyCard() {
  return (
    <div className="m-system m-system-static" data-testid="text-cody-card">
      <span className="m-system-name">Text Cody</span>
      <span className="m-system-stat m-mono" data-testid="text-cody-number">
        {SHARED_NUMBER_DISPLAY} — text Cody anytime, on the go
      </span>
      <span className="m-chip m-system-prim">ZeroVoice</span>
      <p className="m-mono m-metric-note" data-testid="text-cody-sms-consent">
        By texting this number, you agree to receive SMS replies from Cody.
        Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help. See{' '}
        <a href="https://zerovoice-frontend-production.up.railway.app/sms-terms" target="_blank" rel="noreferrer">
          SMS Program Terms
        </a>.
      </p>
    </div>
  )
}
