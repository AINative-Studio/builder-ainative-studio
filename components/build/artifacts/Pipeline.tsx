'use client'

/** Sales Pipeline (#225, §21) — agent-run CRM: Scout + Closer + kanban. ZeroPipeline. */

interface Deal { co: string; v: string; next: string; agent: string; won?: boolean }
const COLUMNS: Array<{ stage: string; deals: Deal[] }> = [
  { stage: 'Qualified', deals: [{ co: 'Northwind Ops', v: '$18k', next: 'Scout booked intro call', agent: 'Scout' }] },
  { stage: 'In conversation', deals: [{ co: 'Acme Retail', v: '$24k', next: 'Closer sent recap + pricing', agent: 'Closer' }, { co: 'Bolt Logistics', v: '$12k', next: 'Awaiting security review', agent: 'Closer' }] },
  { stage: 'Proposal', deals: [{ co: 'Vertex Health', v: '$32k', next: 'Proposal out, follow-up Fri', agent: 'Closer' }] },
  { stage: 'Closed won', deals: [{ co: 'Pike Manufacturing', v: '$0k', next: 'Auto-billed via ZeroInvoice', agent: 'Closer', won: true }] },
]

export function Pipeline() {
  return (
    <>
      <p className="m-sub">
        Agent-first CRM. You don&apos;t chase leads — <strong>Scout</strong> finds and qualifies them,
        <strong> Closer</strong> works each deal to signature. You approve the moves that matter.
      </p>
      <div className="m-pipe-agents">
        {[['Scout', 'Sourcing & qualifying leads'], ['Closer', 'Working 4 open deals']].map(([n, t]) => (
          <div key={n} className="m-agent is-working">
            <div className="m-agent-head"><span className="m-mono m-agent-name">◇ {n}</span><span className="m-agent-badge is-working">●</span></div>
            <div className="m-agent-task">{t}</div>
          </div>
        ))}
      </div>
      <div className="m-kanban m-seams">
        {COLUMNS.map((col) => {
          const total = col.deals.reduce((s, d) => s + parseInt(d.v) || 0, 0)
          return (
            <div key={col.stage} className="m-kan-col">
              <div className="m-kan-head m-mono">{col.stage} · {col.deals.length} · ${total}k</div>
              {col.deals.map((d) => (
                <div key={d.co} className={`m-deal ${d.won ? 'is-won' : ''}`}>
                  <div className="m-deal-top"><span className="m-deal-co">{d.co}</span><span className="m-mono m-deal-v">{d.v}</span></div>
                  <div className="m-deal-next">{d.next}</div>
                  <span className="m-deal-agent m-mono">◇ {d.agent}</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
      <p className="m-artifact-meta m-mono" style={{ marginTop: 16 }}>ZeroPipeline · Agent Cloud swarm · closed deals auto-bill through ZeroInvoice</p>
    </>
  )
}
