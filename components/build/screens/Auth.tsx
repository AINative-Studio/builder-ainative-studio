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
import { decideLimitAction } from '@/lib/build/value-moment'
import { toE164 } from '@/lib/build/otp'

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

/**
 * #651 — persistent exit from the auth flow. Before this, login/signup/forgot
 * had no path back to the landing page short of the browser back button or
 * retyping the URL. The logo and the explicit back control both go straight
 * to 'landing' — a plain GOTO_SCREEN dispatch, never a signIn/register call,
 * so no session is ever created by clicking either.
 */
function AuthHeader({ go }: { go: (s: Screen) => void }) {
  return (
    <div className="m-auth-header m-mono" data-testid="auth-header">
      <button className="m-auth-logo" data-testid="auth-logo-home" onClick={() => go('landing')}>
        BUILDER
      </button>
      <button className="m-back" data-testid="auth-back-home" onClick={() => go('landing')}>
        ← Back to site
      </button>
    </div>
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
  // #734 — phone capture + OTP verification, signup only. Mirrors the
  // verifyEmail/resendNote/resendVerification shape above exactly:
  // `phone` is the raw input; `verifyPhone` (set once an OTP has been sent)
  // holds the E.164-normalized number the code was sent to and gates final
  // signup submission until `phoneVerified` becomes true; `otpNote` mirrors
  // `resendNote`'s inline status-message role.
  const [phone, setPhone] = useState('')
  const [verifyPhone, setVerifyPhone] = useState<string | null>(null)
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [otpNote, setOtpNote] = useState<string | null>(null)

  const copy = {
    login: { h: 'Welcome back', sub: 'Log in to your workspace.', cta: 'Log in' },
    signup: { h: 'Create your account', sub: 'Build free on a 72-hour trial — no card required.', cta: 'Create account' },
    forgot: { h: 'Reset your password', sub: "Enter your email and we'll send a reset link.", cta: 'Send reset link' },
    reset: { h: 'Set a new password', sub: 'Choose a strong password for your account.', cta: 'Update password' },
  }[mode]

  // After auth, resume whatever the founder was doing:
  // - If they hit the auth wall by submitting an idea (#dashboard-ux), a
  //   pendingBuild is stashed — fire the deferred START_BUILD now so generation
  //   begins on their newly-registered account and they land on the workspace
  //   watching Cody build (then the Live dashboard + clickable prototype).
  // - Otherwise return to the company's Live screen (or fork) as before.
  const afterAuth = async () => {
    if (state.pendingBuild) {
      const pb = state.pendingBuild
      // Freemium enforcement (#dashboard-ux): count this newly-registered founder's
      // first build; if somehow already at their limit, route to pricing. Fails OPEN.
      // Value-moment gate (#310/#311): a founder who has never seen a working
      // preview always proceeds to build — never a pay gate before first value.
      // idea/track let the server compute the composed primitives for the
      // ecosystem-runway bonus (#324 GR-15) — server-decided, never client-sent.
      let runwayNote = ''
      try {
        const res = await fetch('/api/build/credits', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: pb.appSub, idea: pb.idea, track: state.track }),
        })
        if (
          res.status === 402 &&
          decideLimitAction({ limitReached: true, sawPreview: state.sawPreview }) === 'pricing'
        ) { go('pricing'); return }
        const d = await res.json().catch(() => null)
        if (typeof d?.ecosystem?.message === 'string') runwayNote = d.ecosystem.message
      } catch { /* fail open */ }
      dispatch({
        type: 'START_BUILD',
        idea: pb.idea, appSub: pb.appSub, companyName: pb.companyName,
        brandTagline: pb.brandTagline, brandColor: pb.brandColor,
      })
      // Surface the earned runway bonus in the workspace (#324 GR-15).
      dispatch({ type: 'SET_RUNWAY_NOTE', note: runwayNote })
      return
    }
    // Polsia-parity landing (founder direction 2026-08-27): a returning founder
    // logs in and lands on THEIR PROJECTS (My Builds dashboard) — the Fork/new-
    // build funnel is only for accounts with no builder projects yet. An active
    // in-browser build (appSub) still resumes on its Live screen first.
    if (state.appSub) { go('live'); return }
    try {
      const r = await fetch('/api/build/my-companies')
      const d = await r.json().catch(() => null)
      // Real bug found live (2026-09-13, core#7395): a real registry-read
      // failure (d?.ok === false, or a non-ok response) used to be treated
      // identically to "this account genuinely has no companies yet" —
      // routing a returning founder with real, existing companies straight
      // into the "Don't build from scratch" new-user funnel during an
      // infrastructure hiccup, tempting them into starting a duplicate
      // build. Land on My Companies instead, which now shows its own honest
      // "couldn't load right now" state (MyCompanies.tsx) rather than a
      // false empty list — never silently assume zero companies from a
      // failed read.
      if (!r.ok || d?.ok === false) { go('companies'); return }
      if (Array.isArray(d?.companies) && d.companies.length > 0) { go('companies'); return }
    } catch {
      // A thrown fetch is the same real-failure case — land on My
      // Companies so its own honest error state can render, not the
      // new-user funnel.
      go('companies')
      return
    }
    go('fork')
  }

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

  // #734 — send a phone OTP (signup only). Mirrors resendVerification's shape:
  // fetch, surface an inline note, never throw past the caller. On success,
  // enters the verify-phone state (verifyPhone set) which renders the code
  // input and gates final signup submission.
  const submitOtp = async () => {
    const normalized = toE164(phone)
    if (!normalized) { setError('Enter a valid phone number.'); return }
    setBusy(true); setError(null); setOtpNote(null)
    try {
      const res = await fetch('/api/build/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send-otp', phone: normalized }),
      })
      const d = await res.json().catch(() => null)
      if (d?.ok) {
        setVerifyPhone(normalized)
        setOtpNote('Code sent — enter it below.')
      } else if (d?.reason === 'not_configured') {
        // Honest infra gap (see lib/build/otp.ts) — phone verification isn't
        // live yet in this environment. Don't dead-end the founder: let them
        // continue without phone verification rather than block signup on
        // an SMS path that cannot actually send today.
        setVerifyPhone(null)
        setPhoneVerified(true)
        setOtpNote(null)
      } else if (d?.reason?.startsWith('rate_limited')) {
        setError('Too many codes requested — try again in a bit.')
      } else {
        setError('Could not send the verification code — try again.')
      }
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  // #734 — verify the submitted OTP code. On success, marks phoneVerified so
  // submit() can proceed with the actual registration call.
  const confirmOtp = async () => {
    if (!verifyPhone || !otpCode) return
    setBusy(true); setError(null); setOtpNote(null)
    try {
      const res = await fetch('/api/build/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify-otp', phone: verifyPhone, code: otpCode, email }),
      })
      const d = await res.json().catch(() => null)
      if (d?.ok) {
        setPhoneVerified(true)
        setVerifyPhone(null)
        setOtpNote(null)
      } else {
        const reason = d?.reason
        setError(
          reason === 'expired' ? 'That code expired — request a new one.'
          : reason === 'already_used' ? 'That code was already used — request a new one.'
          : 'Incorrect code — try again.',
        )
      }
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    setError(null); setResendNote(null)
    if (mode === 'forgot' || mode === 'reset') { setError('Password reset is coming soon — contact support.'); return }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError('Enter a valid email.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    // #734 — gate final signup submission on phone verification completing,
    // once a phone number has been entered at all. A founder who never typed
    // a phone (or whose only path was the not_configured fallback above,
    // which sets phoneVerified:true directly) is unaffected.
    if (mode === 'signup' && phone.trim() && !phoneVerified) {
      setError('Verify your phone number to continue.'); return
    }
    setBusy(true)
    try {
      if (mode === 'signup') {
        // Register against CORE (carries the gclid from the ad-landing cookie so the
        // eventual paid conversion attributes to the Google Ads click). New /build
        // surface — NOT the legacy (auth) actions.
        const normalizedPhone = phone.trim() ? toE164(phone) : null
        const res = await fetch('/api/build/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, phone: normalizedPhone || undefined }),
        })
        const d = await res.json().catch(() => null)
        if (!d?.ok) {
          setError(d?.error?.includes('already') ? 'That email is already registered — log in instead.' : (d?.error || 'Could not create your account.'))
          setBusy(false); return
        }
        trackEvent('sign_up', 'funnel', state.track)
        // Meta Pixel CompleteRegistration (mirrors GA4 sign_up). No-op if the pixel
        // isn't configured. #465 — the register route now also reports this via
        // server-side CAPI (survives ad-blockers/ITP) and returns the SAME
        // deterministic event id it used, so Meta dedups the Pixel/CAPI pair
        // instead of double-counting the conversion.
        trackMeta('CompleteRegistration', { content_name: state.track }, d.metaEventId)
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
          <AuthHeader go={go} />
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
        <AuthHeader go={go} />
        {mode === 'reset' && <p className="m-auth-chip m-mono">✓ Link sent to your email</p>}
        {/* Auth wall (#dashboard-ux): when the founder was gated here by submitting
            an idea, greet them with the named company so registration reads as the
            next step toward their build — not an interruption. */}
        {mode === 'signup' && state.pendingBuild?.companyName && (
          <p className="m-auth-chip m-mono" data-testid="auth-pending-company">
            ◇ {state.pendingBuild.companyName} is ready to build — create your account to start.
          </p>
        )}
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
          {/* #734 — phone input, signup only. Not required: an empty phone never
              blocks submit() (see the phoneVerified gate above), so this is an
              opt-in verification step rather than a hard signup requirement. */}
          {mode === 'signup' && !verifyPhone && (
            <label className="m-field"><span className="m-mono m-field-l">Phone (optional)</span>
              <input type="tel" data-testid="auth-phone" placeholder="+1 555 000 1111" value={phone}
                onChange={(e) => { setPhone(e.target.value); setPhoneVerified(false) }}
                onKeyDown={(e) => e.key === 'Enter' && phone.trim() && submitOtp()} /></label>
          )}
          {mode === 'signup' && phone.trim() && !verifyPhone && !phoneVerified && (
            <button className="btn-ghost" data-testid="auth-send-otp" onClick={submitOtp} disabled={busy} type="button">
              {busy ? 'Sending…' : 'Send verification code →'}
            </button>
          )}
          {mode === 'signup' && phoneVerified && (
            <p className="m-mono" data-testid="auth-phone-verified" style={{ color: '#1f7a3d' }}>✓ Phone verified</p>
          )}
          {mode === 'signup' && verifyPhone && (
            <label className="m-field"><span className="m-mono m-field-l">Verification code</span>
              <input type="text" inputMode="numeric" data-testid="auth-otp-code" placeholder="6-digit code" value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirmOtp()} /></label>
          )}
          {otpNote && <p className="m-mono" data-testid="auth-otp-note" style={{ color: '#1f7a3d' }}>{otpNote}</p>}
          {mode === 'signup' && verifyPhone && (
            <button className="btn-ghost" data-testid="auth-verify-otp" onClick={confirmOtp} disabled={busy || !otpCode} type="button">
              {busy ? 'Verifying…' : 'Verify code →'}
            </button>
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
