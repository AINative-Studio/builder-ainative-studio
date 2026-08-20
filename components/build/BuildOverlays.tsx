'use client'

/**
 * Build overlays (#207 · 04-SCREENS §3) — the full-bleed "watch Cody build"
 * states that cover the workspace center during autoplay. Driven by
 * state.overlay set by useAutoplay:
 *   forming      → an artifact is being written (shimmer sections)
 *   swarm        → the 5-agent swarm is shipping the MVP
 *   provisioning → infra checklist ticking to done
 * Returns null when overlay.kind === 'none'.
 */

import { useBuild } from '@/contexts/build-context'
import { ARTIFACT_TITLES } from '@/lib/build/titles'

const SWARM_AGENTS = [
  { name: 'Architect', role: 'System design' },
  { name: 'Backend', role: 'Server implementation' },
  { name: 'Frontend', role: 'UI implementation' },
  { name: 'QA', role: 'Testing' },
  { name: 'Security', role: 'Threat analysis' },
]

const INFRA_ITEMS = [
  ['ZeroDB project', 'vectors + tables + embeddings'],
  ['ZeroMemory namespace', 'per-workspace isolation'],
  ['Agent Cloud deploy', 'answer agent, auto-scale'],
  ['Identity', 'OAuth 2.1 + PKCE'],
]

export function BuildOverlays() {
  const { state } = useBuild()
  const o = state.overlay
  if (o.kind === 'none') return null

  if (o.kind === 'forming') {
    return (
      <div className="m-overlay m-formin" role="status" aria-live="polite">
        <span className="m-overlay-pill m-mono">GENERATING · {o.view}</span>
        <p className="m-overlay-pulse m-mono"><span className="m-live-dot" /> Cody is writing this</p>
        <h1 className="m-artifact m-overlay-h">{ARTIFACT_TITLES[o.view] ?? o.view}</h1>
        <div className="m-overlay-lines">
          {[92, 78, 85, 60, 70].map((w, i) => (
            <div key={i} className="m-shimmer m-gen-line" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    )
  }

  if (o.kind === 'swarm') {
    // ribbon lines that mention each agent flip it to "working/done"
    const ribbon = state.ribbon.join(' ')
    return (
      <div className="m-overlay m-formin" role="status" aria-live="polite">
        <span className="m-overlay-pill m-mono">SWARM WORKING</span>
        <h1 className="m-artifact m-overlay-h">Cody&apos;s swarm is building the MVP</h1>
        <div className="m-agent-grid">
          {SWARM_AGENTS.map((a) => {
            const active = ribbon.toLowerCase().includes(a.name.toLowerCase())
            return (
              <div key={a.name} className={`m-agent ${active ? 'is-working' : ''}`}>
                <div className="m-agent-head">
                  <span className="m-mono m-agent-name">{a.name}</span>
                  <span className={`m-agent-badge ${active ? 'is-working' : 'is-idle'}`}>{active ? '●' : '·'}</span>
                </div>
                <div className="m-mono m-agent-role">{a.role}</div>
                <div className="m-agent-bar"><span style={{ width: active ? '70%' : '0%' }} /></div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // provisioning
  const ticked = state.ribbon.length
  return (
    <div className="m-overlay m-formin" role="status" aria-live="polite">
      <span className="m-overlay-pill m-mono">PROVISIONING</span>
      <h1 className="m-artifact m-overlay-h">Provisioning your infrastructure</h1>
      <p className="m-sub">Provision everything, ask nothing — real primitives, spun up for you.</p>
      <ul className="m-list m-checklist">
        {INFRA_ITEMS.map(([n, d], i) => (
          <li key={n}>
            <span className={`st ${i < ticked ? 'is-done' : 'is-running'}`} />
            <strong>{n}</strong> <span className="m-mono m-muted">{d}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
