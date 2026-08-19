'use client'

/** Account (#227) — profile, usage meters, plans, API keys, security, notifications. */

import { useBuild } from '@/contexts/build-context'

const METERS = [
  { label: 'API credits', used: 3400, total: 10000, unit: '' },
  { label: 'LLM tokens', used: 1.2, total: 5, unit: 'M' },
  { label: 'Storage', used: 0.8, total: 5, unit: 'GB' },
  { label: 'MCP hours', used: 6, total: 40, unit: 'h' },
]

export function Account() {
  const { dispatch } = useBuild()
  return (
    <div className="modernist m-account">
      <header className="m-account-head">
        <button className="m-back" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'ws' })}>← Back to app</button>
        <h1 className="m-artifact m-account-h">Account</h1>
        <button className="btn-ghost">Sign out</button>
      </header>

      <section className="m-account-profile">
        <div className="m-avatar m-mono">TB</div>
        <div><div className="m-profile-name">Toby</div><div className="m-mono m-profile-email">toby@ainative.studio</div></div>
        <span className="m-chip m-profile-plan">Pro</span>
      </section>

      <section className="m-account-sec">
        <h2 className="m-mono m-account-sec-h">Usage this month</h2>
        <div className="m-meters">
          {METERS.map((m) => (
            <div key={m.label} className="m-meter">
              <div className="m-meter-top"><span className="m-mono m-meter-l">{m.label}</span><span className="m-mono m-meter-v">{m.used}{m.unit} / {m.total}{m.unit}</span></div>
              <div className="m-meter-bar"><span style={{ width: `${(m.used / m.total) * 100}%` }} /></div>
            </div>
          ))}
        </div>
        <p className="m-mono m-meter-reset">Resets in 12 days</p>
      </section>

      <section className="m-account-sec">
        <h2 className="m-mono m-account-sec-h">API keys</h2>
        <div className="m-keys">
          <div className="m-key-row"><span className="m-mono">sk_live_••••••4a2f</span><span className="m-mono m-muted">3.4k calls</span><button className="btn-ghost">Revoke</button></div>
        </div>
        <button className="btn-secondary">+ Create API key</button>
      </section>

      <section className="m-account-sec">
        <h2 className="m-mono m-account-sec-h">Security</h2>
        <div className="m-sec-rows">
          <div className="m-sec-row"><span>Two-factor authentication</span><span className="st is-done">Enabled</span></div>
          <div className="m-sec-row"><span>Active sessions</span><button className="btn-ghost">Sign out all</button></div>
        </div>
      </section>
    </div>
  )
}
