'use client'

/**
 * Generic artifact frame (#220) — H1 + status pill + meta scaffold every
 * artifact screen shares. Rich per-artifact bodies (#223/#224/#225) render as
 * children; this provides the consistent chrome + Next/keep-going controls.
 */

import { useBuild } from '@/contexts/build-context'
import type { ReactNode } from 'react'

/** Stable artifact IDs per 04-SCREENS (PB-01, PRD-01, …). */
const ARTIFACT_ID: Record<string, string> = {
  brief: 'PB-01', prd: 'PRD-01', comp: 'CP-01', dataModel: 'DM-01', memoryPolicy: 'MP-01',
  agentDef: 'AD-01', apiSpec: 'API-01', backlog: 'BL-01', swarm: 'SW-01', infra: 'IN-01', preview: 'PV-01',
  thesis: 'VT-01', wedge: 'WD-01', businessModel: 'BM-01', positioning: 'POS-01', landing: 'LP-01', plan30: 'OP-01',
  pipeline: 'SP-01', conflict: 'CF-01', graph: 'GR-01',
}

function statusClass(status: string): string {
  if (/build|run|generat|accret/i.test(status)) return 'is-running'
  if (/need|input/i.test(status)) return 'is-needs'
  if (/done|approv|connect|ship|deploy|provision|live|ready|assigned/i.test(status)) return 'is-done'
  return ''
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

      {!state.auto && (
        <div className="m-artifact-nav">
          <button className="btn-ghost" disabled={!prev} onClick={() => prev && goView(prev as never)}>‹ Back</button>
          <button className="btn-secondary" disabled={!next} onClick={() => next && goView(next as never)}>Next ›</button>
        </div>
      )}
      {state.auto && (
        <div className="m-artifact-nav">
          <button className="btn-ghost" onClick={() => dispatch({ type: 'TAKE_THE_WHEEL' })}>Take the wheel</button>
        </div>
      )}
    </article>
  )
}
