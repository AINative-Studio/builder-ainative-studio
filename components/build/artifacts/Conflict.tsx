'use client'

/** Dependency Conflict (#225, §22) — blocking alert + traced impact list w/ propagation. */

import { useBuild } from '@/contexts/build-context'

const IMPACT = [
  { kind: 'Breaking', artifact: 'Business Model', why: 'Pricing assumes the old segment' },
  { kind: 'Breaking', artifact: 'Positioning', why: 'Statement names the old buyer' },
  { kind: 'Needs update', artifact: 'Landing Page', why: 'Hero copy + feature framing' },
  { kind: 'Needs update', artifact: '30-Day Plan', why: 'Week-1 target changes' },
  { kind: 'Needs update', artifact: 'Sales Pipeline', why: 'Scout ICP filters' },
  { kind: 'Minor', artifact: 'Venture Thesis', why: 'Wedge section reference' },
]

export function Conflict() {
  const { state, dispatch } = useBuild()

  if (state.conflictResolved) {
    return (
      <div className="m-conflict-done">
        <p><span className="m-glyph">◇</span> Coordinated update applied. Six artifacts re-connected — no orphans left behind.</p>
        <button className="btn-secondary" onClick={() => dispatch({ type: 'GOTO_VIEW', view: 'graph' })}>Continue · see the graph ›</button>
      </div>
    )
  }

  const approve = () => {
    dispatch({ type: 'SET_PROPAGATING', propagating: true })
    setTimeout(() => dispatch({ type: 'RESOLVE_CONFLICT' }), IMPACT.length * 120 + 400)
  }

  return (
    <>
      <div className="m-alert-banner">
        <span className="m-mono m-alert-tag">Conflict · blocking</span>
        <p>Changing the customer segment affects <strong>six artifacts</strong>, including your pricing model and landing page. Review the proposed updates?</p>
        <div className="m-alert-actions">
          <button className="btn-secondary">Review updates</button>
          <button className="m-btn-alert" onClick={approve}>Approve coordinated update</button>
        </div>
      </div>
      <div className="m-impact-list">
        {IMPACT.map((it, i) => (
          <div key={it.artifact} className={`m-impact-row is-${it.kind.toLowerCase().replace(' ', '-')} ${state.propagating ? 'is-propagating' : ''}`} style={{ animationDelay: `${i * 0.12}s` }}>
            <span className="m-impact-kind m-mono">{it.kind}</span>
            <span className="m-impact-name">{it.artifact}<em>{it.why}</em></span>
            <span className={`st ${state.propagating ? 'is-done' : ''}`}>{state.propagating ? 'reconnected' : 'affected'}</span>
          </div>
        ))}
      </div>
    </>
  )
}
