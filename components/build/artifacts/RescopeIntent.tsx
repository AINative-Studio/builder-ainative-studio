'use client'

/**
 * Rescope Intent (#286) — context-setting lead-in shown BEFORE the Dependency
 * Conflict screen when the founder clicks "Re-scope the wedge".
 *
 * Goal: turn a jarring "Dependency Conflict · blocking" drop into a deliberate,
 * informed decision. This screen explains what re-scoping does, which artifacts
 * it touches, and gives a clear back-to-{company} escape before any commitment.
 */

import { useBuild } from '@/contexts/build-context'
import { traceImpact } from '@/lib/build/artifact-graph'
import { ARTIFACT_TITLES } from '@/lib/build/titles'

export function RescopeIntent() {
  const { state, dispatch } = useBuild()

  // Which artifact triggered re-scope (wedge for company track, prd for app track).
  const changedView = state.conflictView || (state.track === 'company' ? 'wedge' : 'prd')
  const changedLabel = ARTIFACT_TITLES[changedView] ?? changedView
  const impact = traceImpact(state.track, changedView)
  const companyLabel = state.companyName || 'your company'

  // Proceeding routes to the actual conflict/dependency resolution screen.
  const proceed = () => {
    dispatch({ type: 'GOTO_VIEW', view: 'conflict' as import('@/lib/build/state').ArtifactView })
  }

  // Back — return to Live without committing to any change.
  const cancel = () => {
    dispatch({ type: 'GOTO_SCREEN', screen: 'live' })
  }

  return (
    <div className="m-rescope-intent">
      <div className="m-alert-banner is-intent">
        <span className="m-mono m-alert-tag">Re-scope · review before committing</span>
        <p>
          You&apos;re about to re-scope <strong>{changedLabel}</strong> for {companyLabel}.
          This is a real upstream edit — it changes the strategic foundation that
          downstream artifacts were built on top of.
        </p>
      </div>

      <div className="m-rescope-body">
        <h2 className="m-h2">What re-scoping does</h2>
        <p className="m-sub">
          Cody will propagate your new wedge through every artifact that depends on it.
          Pricing models, positioning copy, and landing page messaging all flow from the
          wedge — they&apos;ll each get a coordinated update so nothing is left orphaned.
        </p>

        <h2 className="m-h2">What it will touch</h2>
        {impact.length === 0 ? (
          <p className="m-sub m-mono">No downstream artifacts detected — this edit is isolated.</p>
        ) : (
          <ul className="m-list m-rescope-impact">
            {impact.map((it) => (
              <li key={it.view} className={`m-rescope-impact-row is-${it.kind.toLowerCase().replace(' ', '-')}`}>
                <span className="m-impact-kind m-mono">{it.kind}</span>
                <span className="m-impact-name">{it.label}</span>
                <em className="m-impact-why">{it.why}</em>
              </li>
            ))}
          </ul>
        )}

        <p className="m-sub m-mono m-rescope-note">
          You&apos;ll review and approve each change before anything is committed — Cody
          won&apos;t overwrite artifacts without your sign-off.
        </p>
      </div>

      <div className="m-rescope-actions m-artifact-nav">
        <button className="btn-ghost" onClick={cancel} data-testid="rescope-cancel">
          ‹ Back to {companyLabel}
        </button>
        <button className="btn-secondary" onClick={proceed} data-testid="rescope-proceed">
          Review the changes →
        </button>
      </div>
    </div>
  )
}
