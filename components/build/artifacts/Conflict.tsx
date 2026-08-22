'use client'

/**
 * Dependency Conflict (#225 §22, wired #234) — blocking alert + REAL traced
 * impact list. When an upstream artifact edit has downstream consequences,
 * TRIGGER_CONFLICT routes here; the impact list is computed from the real
 * composition graph (traceImpact), not hardcoded. Approving propagates and
 * unblocks; then the user can open the real artifact graph.
 *
 * #283: This view is a SHARED_LATE_VIEW — its navigation is handled by
 * ArtifactFrame's explicit CTA layer, not the generic pager. Back-to-{company}
 * and "See the graph" are always reachable; no user can get trapped here.
 *
 * #286: Framing is "here's what changes if you re-scope" rather than an error
 * state — the blocker is a coordination gate, not a failure.
 */

import { useBuild } from '@/contexts/build-context'
import { traceImpact } from '@/lib/build/artifact-graph'
import { ARTIFACT_TITLES } from '@/lib/build/titles'

export function Conflict() {
  const { state, dispatch } = useBuild()
  const changed = state.conflictView || (state.track === 'company' ? 'wedge' : 'prd')
  const impact = traceImpact(state.track, changed)
  const changedLabel = ARTIFACT_TITLES[changed] ?? changed
  const companyLabel = state.companyName || 'your company'

  if (state.conflictResolved) {
    return (
      <div className="m-conflict-done">
        <p>
          <span className="m-glyph">◇</span> Coordinated update applied.{' '}
          {impact.length} artifact{impact.length === 1 ? '' : 's'} re-connected — no orphans left behind.
        </p>
        <div className="m-artifact-nav">
          <button className="btn-ghost" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'live' })}>
            ‹ Back to {companyLabel}
          </button>
          <button className="btn-secondary" onClick={() => dispatch({ type: 'GOTO_VIEW', view: 'graph' })}>
            See the artifact graph →
          </button>
        </div>
      </div>
    )
  }

  const approve = () => {
    dispatch({ type: 'SET_PROPAGATING', propagating: true })
    setTimeout(() => dispatch({ type: 'RESOLVE_CONFLICT' }), impact.length * 120 + 400)
  }

  return (
    <>
      <div className="m-alert-banner is-coordination">
        <span className="m-mono m-alert-tag">Coordination required</span>
        <p>
          Changing <strong>{changedLabel}</strong> affects{' '}
          <strong>{impact.length} artifact{impact.length === 1 ? '' : 's'}</strong> that were
          built on top of it — including your pricing model and landing page. Here&apos;s what
          Cody will update if you approve. Review the proposed changes below, then approve
          to let Cody reconnect everything cleanly.
        </p>
        <div className="m-alert-actions">
          <button className="btn-ghost" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'live' })}>
            ‹ Back to {companyLabel}
          </button>
          <button className="btn-secondary" onClick={approve}>Review updates</button>
          <button className="m-btn-alert" onClick={approve}>Approve coordinated update</button>
        </div>
      </div>
      <div className="m-impact-list">
        {impact.map((it, i) => (
          <div
            key={it.view}
            className={`m-impact-row is-${it.kind.toLowerCase().replace(' ', '-')} ${state.propagating ? 'is-propagating' : ''}`}
            style={{ animationDelay: `${i * 0.12}s` }}
          >
            <span className="m-impact-kind m-mono">{it.kind}</span>
            <span className="m-impact-name">{it.label}<em>{it.why}</em></span>
            <span className={`st ${state.propagating ? 'is-done' : ''}`}>{state.propagating ? 'reconnected' : 'will update'}</span>
          </div>
        ))}
      </div>
    </>
  )
}
