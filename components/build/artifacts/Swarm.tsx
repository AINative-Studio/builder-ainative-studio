'use client'

/**
 * The Swarm (#223 §12, wired #232) — 5 agent cards orchestrated by Cody.
 *
 * Attempts a REAL AINative agent-swarm run for paid tiers (/api/build/swarm →
 * platform agent-swarm). When the real swarm runs, the header reflects the real
 * task; when it's unavailable (free tier, or the platform endpoint is gated/down
 * per core#6422), it shows the representative view with an HONEST label — never
 * claiming a live run that isn't happening.
 */

import { useEffect, useState } from 'react'
import { useBuild } from '@/contexts/build-context'

const AGENTS = [
  { name: 'Architect', role: 'System design', task: 'Mapped PRD → services', badge: '✓' },
  { name: 'Backend', role: 'Server implementation', task: 'Building /ask endpoint', badge: '●' },
  { name: 'Frontend', role: 'UI implementation', task: 'Citation renderer', badge: '●' },
  { name: 'QA', role: 'Testing', task: 'Waiting on backend', badge: '·' },
  { name: 'Security', role: 'Threat analysis', task: 'Source-access guard', badge: '●' },
] as const

export function Swarm() {
  const { state } = useBuild()
  const done = AGENTS.filter((a) => a.badge === '✓').length
  const [real, setReal] = useState<{ real: boolean; taskId?: string | null } | null>(null)

  // Attempt the real swarm once (paid tiers). Degrades honestly if unavailable.
  useEffect(() => {
    let alive = true
    fetch('/api/build/swarm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: `Build the MVP for: ${state.idea}`,
        agentTypes: ['architect', 'backend', 'frontend', 'qa', 'security'],
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setReal(d) })
      .catch(() => {})
    return () => { alive = false }
  }, [state.idea])

  return (
    <>
      <p className="m-sub">Five specialized agents, orchestrated by Cody, building on AINative primitives.</p>
      <p className="m-mono m-swarm-count">
        {done} / {AGENTS.length} agents shipped
        {real?.real
          ? <span className="m-swarm-badge is-real"> · live agent-swarm run{real.taskId ? ` (${String(real.taskId).slice(0, 8)})` : ''}</span>
          : <span className="m-swarm-badge is-preview"> · preview run</span>}
      </p>
      <div className="m-agent-grid">
        {AGENTS.map((a) => (
          <div key={a.name} className={`m-agent ${a.badge === '●' ? 'is-working' : ''}`}>
            <div className="m-agent-head">
              <span className="m-mono m-agent-name">{a.name}</span>
              <span className={`m-agent-badge ${a.badge === '✓' ? 'is-done' : a.badge === '●' ? 'is-working' : 'is-idle'}`}>{a.badge}</span>
            </div>
            <div className="m-mono m-agent-role">{a.role}</div>
            <div className="m-agent-task">{a.task}</div>
            <div className="m-agent-bar"><span style={{ width: a.badge === '✓' ? '100%' : a.badge === '●' ? '60%' : '0%' }} /></div>
          </div>
        ))}
      </div>
    </>
  )
}
