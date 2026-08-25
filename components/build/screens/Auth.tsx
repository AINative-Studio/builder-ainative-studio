'use client'

/** Auth screens (#227) — two-column, alert-red brand panel + form. 04-SCREENS Auth. */

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useBuild } from '@/contexts/build-context'
import type { Screen } from '@/lib/build/state'
import { trackEvent } from '@/components/analytics/google-analytics'
import { trackMeta } from '@/components/analytics/meta-pixel'

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

  const copy = {
    login: { h: 'Welcome back', sub: 'Log in to your workspace.', cta: 'Log in' },
    signup: { h: 'Create your account', sub: 'Build free on a 72-hour trial — no card required.', cta: 'Create account' },
    forgot: { h: 'Reset your password', sub: "Enter your email and we'll send a reset link.", cta: 'Send reset link' },
    reset: { h: 'Set a new password', sub: 'Choose a strong password for your account.', cta: 'Update password' },
  }[mode]

  // After auth, return to the company's Live screen (or fork) so the founder lands
  // back on what they were building — now signed in.
  const afterAuth = () => go(state.appSub ? 'live' : 'fork')

  const submit = async () => {
    setError(null)
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
      }
      // Sign in (both signup + login) via the core-backed next-auth credentials provider.
      const result = await signIn('credentials', { email, password, redirect: false })
      if (result?.error) { setError('Wrong email or password.'); setBusy(false); return }
      afterAuth()
    } catch {
      setError('Network error — try again.')
      setBusy(false)
    }
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
        <div className="m-auth-links m-mono">
          {mode === 'login' && <><button className="btn-ghost" onClick={() => go('forgot')}>Forgot password?</button><button className="btn-ghost" onClick={() => go('signup')}>Create account</button></>}
          {mode === 'signup' && <button className="btn-ghost" onClick={() => go('login')}>Already have an account? Log in</button>}
          {(mode === 'forgot' || mode === 'reset') && <button className="btn-ghost" onClick={() => go('login')}>← Back to log in</button>}
        </div>
      </main>
    </div>
  )
}
