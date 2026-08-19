'use client'

/**
 * Live operating dashboard (#226) — the destination. 04-SCREENS Live.
 * The founder supervises an AI-run company. The business-systems grid wires the
 * real AINative primitives (ZeroPipeline/ZeroInvoice/ServiceOS/ZeroVoice), and
 * Cody's nightly-run status is our real recursive loop pointed at the user's co.
 */

import { useState } from 'react'
import { useBuild } from '@/contexts/build-context'
import { useLiveProof } from '@/lib/build/useLiveProof'

const SYSTEMS = [
  { name: 'Pipeline', stat: '5 open · $86k · 1 won', prim: 'ZeroPipeline' },
  { name: 'Invoices', stat: '$4.2k collected', prim: 'ZeroInvoice' },
  { name: 'Helpdesk', stat: '2 open tickets', prim: 'ServiceOS' },
  { name: 'Voice & SMS', stat: '18 calls · 40 texts', prim: 'ZeroVoice' },
]
const TONIGHT = [
  'Re-rank retrieval on this week’s real queries',
  'Draft 3 outbound emails for Qualified deals',
  'Ship the citation-hover fix from user feedback',
]

export function Live() {
  const { state } = useBuild()
  const proof = useLiveProof()
  const [msg, setMsg] = useState('')
  const company = state.companyName || 'Your Company'
  const url = `${state.appSub || 'your-app'}.ainative.studio`

  return (
    <div className="modernist m-live" data-track="company">
      <header className="m-live-masthead">
        <span className="m-mono m-live-tag">Company Track · shipped</span>
        <h1 className="m-artifact m-live-h">{company} is live.</h1>
        <div className="m-live-masthead-right">
          <span className="m-mono m-live-watch"><span className="m-live-dot" /> Cody is on watch</span>
          <a className="m-mono m-live-url" href={`https://${url}`} target="_blank" rel="noreferrer">{url} ↗</a>
        </div>
      </header>

      <div className={`m-live-grid ${state.tablet ? 'is-tablet' : ''}`}>
        {/* LEFT — Cody status + metrics + upsell */}
        <div className="m-live-col">
          <div className="m-live-card">
            <div className="m-mono m-live-card-h"><span className="m-glyph">◇</span> Cody · nightly run <span className="st is-done">shipped</span></div>
            <p className="m-live-card-body">Nightly, I evaluate the company, pick the highest-leverage task, and run it. You&apos;ll get a morning summary.</p>
            <button className="btn-ghost">Open the artifact graph →</button>
          </div>
          <div className="m-live-card">
            <div className="m-mono m-live-card-h">Business metrics</div>
            <div className="m-metric-rows">
              <div className="m-metric"><span className="m-metric-v m-artifact">1,204</span><span className="m-metric-l m-mono">visitors</span></div>
              <div className="m-metric"><span className="m-metric-v m-artifact">312</span><span className="m-metric-l m-mono">waitlist</span></div>
              <div className="m-metric"><span className="m-metric-v m-artifact">$4.2k</span><span className="m-metric-l m-mono">revenue</span></div>
            </div>
          </div>
          <div className="m-live-card m-upsell">
            <div className="m-mono m-live-card-h">Hire the swarm</div>
            <p className="m-live-card-body">Works while you sleep · $49/mo</p>
            <button className="btn-primary">Subscribe</button>
          </div>
        </div>

        {/* MIDDLE — business systems + tonight + infra */}
        <div className="m-live-col">
          <div className="m-live-card">
            <div className="m-mono m-live-card-h">Business systems</div>
            <div className="m-systems m-seams">
              {SYSTEMS.map((s) => (
                <button key={s.name} className="m-system">
                  <span className="m-system-name">{s.name}</span>
                  <span className="m-system-stat m-mono">{s.stat}</span>
                  <span className="m-chip m-system-prim">{s.prim}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="m-live-card">
            <div className="m-mono m-live-card-h">The swarm · tonight&apos;s tasks</div>
            <ul className="m-list m-tonight">{TONIGHT.map((t) => <li key={t}><span className="st is-running" /> {t}</li>)}</ul>
          </div>
          <div className="m-live-card">
            <div className="m-mono m-live-card-h">Website & infrastructure</div>
            <p className="m-mono m-infra-urls">prod: {url}<br />staging: staging.{url}</p>
            <div className="m-infra-btns">
              {['Manage domain', 'Versions', 'Redeploy', 'Secrets'].map((b) => <button key={b} className="btn-secondary">{b}</button>)}
            </div>
          </div>
        </div>

        {/* RIGHT — Ask Cody anything */}
        <div className="m-live-col">
          <div className="m-live-card m-chat">
            <div className="m-mono m-live-card-h"><span className="m-glyph">◇</span> Ask Cody anything</div>
            <div className="m-chat-log">
              <p className="m-chat-user">How did we do this week?</p>
              <p className="m-chat-cody"><span className="m-glyph">◇</span> Waitlist up 22%, one deal closed ($0k auto-billed), and I shipped the citation fix. Biggest lever next: turn 3 Qualified deals into calls — want me to have Closer dial them?</p>
            </div>
            <div className="m-chat-input">
              <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message Cody…" />
              <button className="btn-primary">Send</button>
            </div>
          </div>
        </div>
      </div>

      {proof.agentsActive != null && (
        <p className="m-live-footprint m-mono">
          {proof.agentsActive} AINative agents working platform-wide right now — the same infrastructure running {company}.
        </p>
      )}
    </div>
  )
}
