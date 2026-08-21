'use client'

/** Auth screens (#227) — two-column, alert-red brand panel + form. 04-SCREENS Auth. */

import { useBuild } from '@/contexts/build-context'
import type { Screen } from '@/lib/build/state'

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
  const { dispatch } = useBuild()
  const go = (s: Screen) => dispatch({ type: 'GOTO_SCREEN', screen: s })

  const copy = {
    login: { h: 'Welcome back', sub: 'Log in to your workspace.', cta: 'Log in' },
    signup: { h: 'Create your account', sub: 'Build free on a 72-hour trial — no card required.', cta: 'Create account' },
    forgot: { h: 'Reset your password', sub: "Enter your email and we'll send a reset link.", cta: 'Send reset link' },
    reset: { h: 'Set a new password', sub: 'Choose a strong password for your account.', cta: 'Update password' },
  }[mode]

  return (
    <div className="modernist m-auth">
      <BrandPanel />
      <main className="m-auth-form">
        {mode === 'reset' && <p className="m-auth-chip m-mono">✓ Link sent to your email</p>}
        <h1 className="m-artifact m-auth-h">{copy.h}</h1>
        <p className="m-sub">{copy.sub}</p>
        <div className="m-auth-fields">
          {(mode === 'login' || mode === 'signup' || mode === 'forgot') && (
            <label className="m-field"><span className="m-mono m-field-l">Email</span><input type="email" placeholder="you@company.com" /></label>
          )}
          {(mode === 'login' || mode === 'signup' || mode === 'reset') && (
            <label className="m-field"><span className="m-mono m-field-l">{mode === 'reset' ? 'New password' : 'Password'}</span><input type="password" placeholder="••••••••" /></label>
          )}
        </div>
        <button className="btn-primary" onClick={() => go('fork')}>{copy.cta} →</button>
        <div className="m-auth-links m-mono">
          {mode === 'login' && <><button className="btn-ghost" onClick={() => go('forgot')}>Forgot password?</button><button className="btn-ghost" onClick={() => go('signup')}>Create account</button></>}
          {mode === 'signup' && <button className="btn-ghost" onClick={() => go('login')}>Already have an account? Log in</button>}
          {(mode === 'forgot' || mode === 'reset') && <button className="btn-ghost" onClick={() => go('login')}>← Back to log in</button>}
        </div>
      </main>
    </div>
  )
}
