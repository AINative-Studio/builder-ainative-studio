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

// Business systems provisioned for a freshly-shipped company. Stats start at the
// honest zero-state (a brand-new company has no deals/invoices yet) — the swarm
// fills them as it runs. Primitives are the real AINative products behind each.
const SYSTEMS = [
  { name: 'Pipeline', stat: 'Ready · Scout sourcing', prim: 'ZeroPipeline' },
  { name: 'Invoices', stat: 'Ready · $0 collected', prim: 'ZeroInvoice' },
  { name: 'Helpdesk', stat: 'Ready · 0 tickets', prim: 'ServiceOS' },
  { name: 'Voice & SMS', stat: 'Ready · 0 calls', prim: 'ZeroVoice' },
]

interface ChatLine { role: 'user' | 'cody'; text: string }

export function Live() {
  const { state, dispatch } = useBuild()
  const proof = useLiveProof()
  const [msg, setMsg] = useState('')
  const [enrolled, setEnrolled] = useState(false)
  const [chat, setChat] = useState<ChatLine[]>([])
  const [asking, setAsking] = useState(false)
  const company = state.companyName || 'Your Company'
  const url = `${state.appSub || 'your-app'}.ainative.studio`

  // Tonight's tasks — real platform-loop signal woven in so it's not fiction.
  const tonight = [
    `Evaluate ${company} and pick the highest-leverage next task`,
    proof.tasksToday != null
      ? `Join the ${proof.tasksToday} agent tasks the platform ran today`
      : 'Run the nightly improvement pass',
    'Summarize outcomes and score them into the RLHF loop',
  ]

  // Reach the real artifact graph from Live (returns to the workspace on the graph view).
  const openGraph = () => {
    dispatch({ type: 'GOTO_VIEW', view: 'graph' })
    dispatch({ type: 'GOTO_SCREEN', screen: 'ws' })
  }
  // Re-scoping the wedge is a real upstream edit with downstream impact → fire the
  // blocking Dependency Conflict gate (traced from the real composition graph).
  const rescopeWedge = () => {
    dispatch({ type: 'TRIGGER_CONFLICT', changedView: state.track === 'company' ? 'wedge' : 'prd' })
  }

  const ask = async () => {
    const q = msg.trim()
    if (!q || asking) return
    setChat((c) => [...c, { role: 'user', text: q }])
    setMsg('')
    setAsking(true)
    try {
      const res = await fetch('/api/build/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, idea: state.idea, companyName: company, track: state.track }),
      })
      const data = await res.json().catch(() => null)
      setChat((c) => [...c, { role: 'cody', text: data?.answer || "I couldn't reach my brain just now — try again in a moment." }])
    } catch {
      setChat((c) => [...c, { role: 'cody', text: 'Connection hiccup — ask me again.' }])
    } finally {
      setAsking(false)
    }
  }

  const subscribe = async () => {
    // Enroll this company in the real nightly autonomous loop (Option B).
    setEnrolled(true) // optimistic
    try {
      await fetch('/api/build/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: state.appSub || company.toLowerCase().replace(/\s+/g, '-'),
          companyName: company,
          track: state.track,
          goal: state.answers?.privacy,
        }),
      })
    } catch { /* optimistic UI already set */ }
  }

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
            <div className="m-live-card-actions">
              <button className="btn-ghost" onClick={openGraph}>Open the artifact graph →</button>
              <button className="btn-ghost" onClick={rescopeWedge}>Re-scope the wedge ⚠</button>
            </div>
          </div>
          <div className="m-live-card">
            <div className="m-mono m-live-card-h">Business metrics</div>
            <div className="m-metric-rows">
              {/* Honest zero-state for a just-shipped company — the swarm fills these. */}
              <div className="m-metric"><span className="m-metric-v m-artifact">0</span><span className="m-metric-l m-mono">visitors</span></div>
              <div className="m-metric"><span className="m-metric-v m-artifact">0</span><span className="m-metric-l m-mono">waitlist</span></div>
              <div className="m-metric"><span className="m-metric-v m-artifact">$0</span><span className="m-metric-l m-mono">revenue</span></div>
            </div>
            <p className="m-mono m-metric-note">Live from day one — Cody grows these nightly.</p>
          </div>
          <div className="m-live-card m-upsell">
            <div className="m-mono m-live-card-h">Hire the swarm</div>
            <p className="m-live-card-body">
              {enrolled
                ? 'Enrolled. Cody runs the nightly loop on your company.'
                : 'Works while you sleep · $49/mo'}
            </p>
            <button className="btn-primary" disabled={enrolled} onClick={subscribe}>
              {enrolled ? '✓ On watch' : 'Subscribe'}
            </button>
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
            <ul className="m-list m-tonight">{tonight.map((t) => <li key={t}><span className="st is-running" /> {t}</li>)}</ul>
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
              {chat.length === 0 && (
                <p className="m-chat-cody"><span className="m-glyph">◇</span> {company} is live and on watch. Ask me anything — what to build next, how the wedge is holding up, or what I&apos;ll run tonight.</p>
              )}
              {chat.map((line, i) =>
                line.role === 'user'
                  ? <p key={i} className="m-chat-user">{line.text}</p>
                  : <p key={i} className="m-chat-cody"><span className="m-glyph">◇</span> {line.text}</p>
              )}
              {asking && <p className="m-chat-cody m-mono"><span className="m-glyph">◇</span> thinking…</p>}
            </div>
            <div className="m-chat-input">
              <input
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && ask()}
                placeholder="Message Cody…"
              />
              <button className="btn-primary" onClick={ask} disabled={asking}>Send</button>
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
