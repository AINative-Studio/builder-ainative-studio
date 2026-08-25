'use client'

/** Auth screens (#227) — two-column, alert-red brand panel + form. 04-SCREENS Auth. */

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useBuild } from '@/contexts/build-context'
import type { Screen } from '@/lib/build/state'
import { trackEvent } from '@/components/analytics/google-analytics'
import { trackMeta } from '@/components/analytics/meta-pixel'
import { migrateGuestWork } from '@/lib/build/guest-migration'
import { getRefCode } from '@/lib/build/attribution'

function BrandPanel() {
  return (
    <aside className="m-auth-brand">
      <span className="m-eyebrow" style={{ color: '#fff' }}>AINATIVE BUILDER</span>
      <h2 className="m-artifact m-auth-statement">Compose intelligent products and AI-native companies.</h2>
      <p className="m-auth-subhead">Your idea is the input. AINative primitives are the building blocks. Cody builds the rest.</p>
      <span className="m-mono m-auth-domain">builder.ainative.studio</span>
    </aside>
  )
}

export function Auth({ mode }: { mode: Extract<Screen, 'login' | 'signup' | 'forgot' | 'reset'> }) {
  const { state, dispatch } = useBuild()
  const go = (s: Screen) => dispatch({ type: 'GOTO_SCREEN', screen: s })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // #74 — when the account exists but email isn't verified, we switch the form
  // into a "check your email" state with a resend action instead of silently
  // dead-ending the founder. `verifyEmail` holds the address the resend targets.
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null)
  const [resendNote, setResendNote] = useState<string | null>(null)

  const copy = {
    login: { h: 'Welcome back', sub: 'Log in to your workspace.', cta: 'Log in' },
    signup: { h: 'Create your account', sub: 'Build free on a 72-hour trial — no card required.', cta: 'Create account' },
    forgot: { h: 'Reset your password', sub: "Enter your email and we'll send a reset link.", cta: 'Send reset link' },
    reset: { h: 'Set a new password', sub: 'Choose a strong password for your account.', cta: 'Update password' },
  }[mode]

  // After auth, return to the company's Live screen (or fork) so the founder lands
  // back on what they were building — now signed in.
  const afterAuth = () => go(state.appSub ? 'live' : 'fork')

  // #74 — enter the "verify your email" state: stop treating the user as logged
  // in and surface a resend action. Called after register signals
  // verificationRequired, or after a login is rejected with
  // AUTH_EMAIL_NOT_VERIFIED (a silent dead-end before this change).
  const enterVerifyState = (addr: string) => {
    setVerifyEmail(addr)
    setResendNote(null)
    setError(null)
    setBusy(false)
  }

  // #74 — resend the verification link via the builder register route
  // (action:'resend' → core POST /api/v1/auth/resend-verification). Core replies
  // with a neutral message whether or not an unverified account exists, so we
  // show the same reassuring confirmation regardless.
  const resendVerification = async () => {
    if (!verifyEmail) return
    setBusy(true); setResendNote(null); setError(null)
    try {
      const res = await fetch('/api/build/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resend', email: verifyEmail }),
      })
      const d = await res.json().catch(() => null)
      setResendNote(d?.ok ? 'Verification email sent — check your inbox.' : (d?.error || 'Could not resend — try again.'))
    } catch {
      setResendNote('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    setError(null); setResendNote(null)
    if (mode === 'forgot' || mode === 'reset') { setError('Password reset is coming soon — contact support.'); return }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError('Enter a valid email.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setBusy(true)
    try {
      if (mode === 'signup') {
        // Register against CORE (carries the gclid from the ad-landing cookie so the
        // eventual paid conversion attributes to the Google Ads click). New /build
        // surface — NOT the legacy (auth) actions.
        const res = await fetch('/api/build/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        const d = await res.json().catch(() => null)
        if (!d?.ok) {
          setError(d?.error?.includes('already') ? 'That email is already registered — log in instead.' : (d?.error || 'Could not create your account.'))
          setBusy(false); return
        }
        trackEvent('sign_up', 'funnel', state.track)
        // Meta Pixel CompleteRegistration (mirrors GA4 sign_up). No-op if the pixel
        // isn't configured. No server CAPI twin for signup, so no shared event_id.
        trackMeta('CompleteRegistration', { content_name: state.track })
        // #74 — if core says email verification is still required, don't pretend
        // the founder is logged in: show the verify-email + resend state instead
        // of auto-signing-in (which would 403 at login and dead-end silently).
        if (d.verificationRequired) { enterVerifyState(email); return }
      }
      // Sign in (both signup + login) via the core-backed next-auth credentials provider.
      const result = await signIn('credentials', { email, password, redirect: false })
      if (result?.error) {
        // #74 — signIn collapses core's error_code into a generic string, so we
        // ask the register route to classify the failure. AUTH_EMAIL_NOT_VERIFIED
        // means the account exists but isn't verified → offer resend, don't show
        // "wrong password". Any other failure is a genuine credential error.
        try {
          const chk = await fetch('/api/build/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'login-check', email, password }),
          })
          const cd = await chk.json().catch(() => null)
          if (cd?.errorCode === 'AUTH_EMAIL_NOT_VERIFIED') { enterVerifyState(email); return }
        } catch { /* fall through to the generic message */ }
        setError('Wrong email or password.'); setBusy(false); return
      }
      // Guest → real migration (#49): re-key any in-progress guest company built
      // before this sign-in to the now-authenticated account so no work is lost.
      // Best-effort — never blocks landing the founder back on their build.
      await migrateGuestWork(state.appSub).catch(() => {})
      // Refer & Earn (#59): if this user landed via a shared referral link, attribute
      // their now-authenticated signup to the referrer (creates a PENDING referral;
      // the referrer is credited later when this user subscribes). Best-effort —
      // never blocks landing the founder back on their build. The server derives the
      // referred identity from the session, so we only pass the captured code.
      const refCode = getRefCode()
      if (refCode) {
        fetch('/api/build/referral', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: refCode }),
        }).catch(() => {})
      }
      afterAuth()
    } catch {
      setError('Network error — try again.')
      setBusy(false)
    }
  }

  // "Sign in with AINative" (#49) — starts the OAuth2.1/PKCE flow. The route
  // mints PKCE + state, stashes them in httpOnly cookies, and 302s to core's
  // /oauth/authorize; the callback establishes the session. A full navigation
  // (not fetch) is required so the browser follows the redirect chain and the
  // cookies are set on the top-level document.
  const oauth = () => { window.location.href = '/api/auth/ainative/authorize' }

  // #74 — verification-required state. Reached after signup (when core requires
  // verification) or after a login rejected with AUTH_EMAIL_NOT_VERIFIED. Gives
  // the founder a clear next step + resend, instead of a silent signup→login
  // dead-end. Preserves the guest→account migration story: nothing is signed in
  // or lost here — once verified, the founder logs in and #49 migration runs.
  if (verifyEmail) {
    return (
      <div className="modernist m-auth">
        <BrandPanel />
        <main className="m-auth-form" data-testid="auth-verify-panel">
          <p className="m-auth-chip m-mono">✓ Account created</p>
          <h1 className="m-artifact m-auth-h">Check your email to verify</h1>
          <p className="m-sub">
            We sent a verification link to <strong data-testid="auth-verify-email">{verifyEmail}</strong>. Click it to
            activate your account, then come back and log in.
          </p>
          {resendNote && <p className="m-mono" data-testid="auth-resend-note" style={{ color: '#1f7a3d' }}>{resendNote}</p>}
          <button className="btn-primary" data-testid="auth-resend" onClick={resendVerification} disabled={busy}>
            {busy ? 'Sending…' : 'Resend verification email →'}
          </button>
          <div className="m-auth-links m-mono">
            <button className="btn-ghost" data-testid="auth-verify-back" onClick={() => { setVerifyEmail(null); setResendNote(null); go('login') }}>
              ← Back to log in
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="modernist m-auth">
      <BrandPanel />
      <main className="m-auth-form">
        {mode === 'reset' && <p className="m-auth-chip m-mono">✓ Link sent to your email</p>}
        <h1 className="m-artifact m-auth-h">{copy.h}</h1>
        <p className="m-sub">{copy.sub}</p>
        <div className="m-auth-fields">
          {(mode === 'login' || mode === 'signup' || mode === 'forgot') && (
            <label className="m-field"><span className="m-mono m-field-l">Email</span>
              <input type="email" data-testid="auth-email" placeholder="you@company.com" value={email}
                onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></label>
          )}
          {(mode === 'login' || mode === 'signup' || mode === 'reset') && (
            <label className="m-field"><span className="m-mono m-field-l">{mode === 'reset' ? 'New password' : 'Password'}</span>
              <input type="password" data-testid="auth-password" placeholder="••••••••" value={password}
                onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></label>
          )}
        </div>
        {error && <p className="m-mono m-auth-error" style={{ color: '#e5451f' }}>{error}</p>}
        <button className="btn-primary" data-testid="auth-submit" onClick={submit} disabled={busy}>
          {busy ? 'Working…' : `${copy.cta} →`}
        </button>
        {(mode === 'login' || mode === 'signup') && (
          <>
            <div className="m-auth-or m-mono"><span>or</span></div>
            <button className="btn-secondary" data-testid="auth-oauth-ainative" onClick={oauth} disabled={busy}>
              Continue with AINative
            </button>
          </>
        )}
        <div className="m-auth-links m-mono">
          {mode === 'login' && <><button className="btn-ghost" onClick={() => go('forgot')}>Forgot password?</button><button className="btn-ghost" onClick={() => go('signup')}>Create account</button></>}
          {mode === 'signup' && <button className="btn-ghost" onClick={() => go('login')}>Already have an account? Log in</button>}
          {(mode === 'forgot' || mode === 'reset') && <button className="btn-ghost" onClick={() => go('login')}>← Back to log in</button>}
        </div>
      </main>
    </div>
  )
}
