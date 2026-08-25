'use client'

/**
 * Generic artifact frame (#220) — H1 + status pill + meta scaffold every
 * artifact screen shares. Rich per-artifact bodies (#223/#224/#225) render as
 * children; this provides the consistent chrome + Next/keep-going controls.
 *
 * #283: SHARED_LATE_VIEWS ('conflict', 'graph', 'rescope-intent') are not in
 * the navigable track sequence (COMPANY_VIEWS / APP_VIEWS), so the generic
 * prev/next pager is always empty for them. Replace the dead pager with
 * explicit escape CTAs so no screen can trap the user.
 */

import { useBuild } from '@/contexts/build-context'
import { SHARED_LATE_VIEWS } from '@/lib/build/state'
import type { ReactNode } from 'react'

/** Stable artifact IDs per 04-SCREENS (PB-01, PRD-01, …). */
const ARTIFACT_ID: Record<string, string> = {
  brief: 'PB-01', prd: 'PRD-01', comp: 'CP-01', dataModel: 'DM-01', memoryPolicy: 'MP-01',
  agentDef: 'AD-01', codingStandards: 'ES-01', apiSpec: 'API-01', backlog: 'BL-01', sprintPlan: 'SPR-01', swarm: 'SW-01', infra: 'IN-01', preview: 'PV-01',
  thesis: 'VT-01', wedge: 'WD-01', businessModel: 'BM-01', positioning: 'POS-01', landing: 'LP-01', plan30: 'OP-01',
  pipeline: 'SP-01', 'rescope-intent': 'RI-01', conflict: 'CF-01', graph: 'GR-01',
}

function statusClass(status: string): string {
  if (/build|run|generat|accret/i.test(status)) return 'is-running'
  if (/need|input/i.test(status)) return 'is-needs'
  if (/done|approv|connect|ship|deploy|provision|live|ready|assigned/i.test(status)) return 'is-done'
  return ''
}

/** Returns true when `view` lives in SHARED_LATE_VIEWS and is not part of the
 *  track sequence — these views need explicit CTA nav instead of the pager. */
function isSharedLateView(view: string): boolean {
  return (SHARED_LATE_VIEWS as readonly string[]).includes(view)
}

export function ArtifactFrame({
  title, status, view, meta, children,
}: {
  title: string
  status: string
  view: string
  meta?: string
  children?: ReactNode
}) {
  const { state, views, goView, dispatch } = useBuild()
  const idx = views.indexOf(view)
  const next = idx >= 0 && idx < views.length - 1 ? views[idx + 1] : null
  const prev = idx > 0 ? views[idx - 1] : null

  const artifactId = ARTIFACT_ID[view]
  const isLate = isSharedLateView(view)
  const companyLabel = state.companyName || 'company'

  // For SHARED_LATE_VIEWS: after conflict is resolved the forward CTA is the
  // graph. For the graph itself the forward CTA returns to Live. This keeps
  // every late view's forward/back chain explicit and never dead (#283).
  const lateBack = () => {
    if (view === 'graph' || view === 'conflict') {
      dispatch({ type: 'GOTO_SCREEN', screen: 'live' })
    } else {
      // 'rescope-intent' or 'pipeline' — go to the last track view
      goView(views[views.length - 1] as never)
    }
  }
  const lateDone = () => {
    if (view === 'conflict' && state.conflictResolved) {
      goView('graph' as never)
    } else {
      dispatch({ type: 'GOTO_SCREEN', screen: 'live' })
    }
  }

  return (
    <article className="m-artifact-frame">
      <div className="m-artifact-status">
        <span className={`st ${statusClass(status)}`}>{status}</span>
        {artifactId && <span className="m-artifact-id m-mono">{artifactId}</span>}
      </div>
      <h1 className="m-artifact m-artifact-h1">{title}</h1>
      {meta && <p className="m-artifact-meta m-mono">{meta}</p>}
      <div className="m-artifact-body">
        {children ?? <p className="m-sub">Cody is composing this artifact from AINative primitives.</p>}
      </div>

      {/* SHARED_LATE_VIEWS: replace the generic pager with explicit escape CTAs
          so the user is never trapped on conflict / graph / rescope-intent (#283). */}
      {isLate ? (
        <div className="m-artifact-nav">
          <button className="btn-ghost" onClick={lateBack}>
            ‹ Back to {companyLabel}
          </button>
          {view === 'conflict' && !state.conflictResolved ? null : (
            <button className="btn-secondary" onClick={lateDone}>
              {view === 'conflict' && state.conflictResolved ? 'See the graph →' : 'Done →'}
            </button>
          )}
        </div>
      ) : !state.auto ? (
        <div className="m-artifact-nav">
          <button className="btn-ghost" disabled={!prev} onClick={() => prev && goView(prev as never)}>‹ Back</button>
          {/* On the LAST artifact (e.g. preview) there is no next artifact, so the
              pager 'Next' used to be a disabled dead-end — users clicked it and
              nothing happened. Instead, advance to the pricing/pay-gate (the real
              forward path, same as the 'Make it real →' CTA) so Next is never dead. */}
          {next ? (
            <button className="btn-secondary" onClick={() => goView(next as never)}>Next ›</button>
          ) : (
            <button className="btn-secondary" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'pricing' })}>Next ›</button>
          )}
        </div>
      ) : (
        <div className="m-artifact-nav">
          <button className="btn-ghost" onClick={() => dispatch({ type: 'TAKE_THE_WHEEL' })}>Take the wheel</button>
        </div>
      )}
    </article>
  )
}
