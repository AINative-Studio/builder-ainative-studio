'use client'

/** The Swarm (#223, §12) — 5 agent cards orchestrated by Cody. */

const AGENTS = [
  { name: 'Architect', role: 'System design', task: 'Mapped PRD → services', badge: '✓' },
  { name: 'Backend', role: 'Server implementation', task: 'Building /ask endpoint', badge: '●' },
  { name: 'Frontend', role: 'UI implementation', task: 'Citation renderer', badge: '●' },
  { name: 'QA', role: 'Testing', task: 'Waiting on backend', badge: '·' },
  { name: 'Security', role: 'Threat analysis', task: 'Source-access guard', badge: '●' },
] as const

export function Swarm() {
  const done = AGENTS.filter((a) => a.badge === '✓').length
  return (
    <>
      <p className="m-sub">Five specialized agents, orchestrated by Cody, building on AINative primitives.</p>
      <p className="m-mono m-swarm-count">{done} / {AGENTS.length} agents shipped</p>
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
