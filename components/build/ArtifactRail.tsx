'use client'

/**
 * Artifact rail (#235 · 03-FLOW "Persistent chrome") — the right-side drawer
 * listing every artifact generated so far, grouped by category, with a done
 * count and a link to the full Artifact Graph. Built from the REAL artifacts in
 * the current build (buildArtifactGraph on the active track + done map). Clicking
 * a done artifact jumps to it.
 */

import { useBuild } from '@/contexts/build-context'
import { buildArtifactGraph, type ArtifactCategory } from '@/lib/build/artifact-graph'
import type { ArtifactView } from '@/lib/build/state'

const CATEGORY_ORDER: ArtifactCategory[] = [
  'Thesis', 'Product', 'Delivery', 'Brand & Distribution', 'Operations', 'Sales & Revenue',
]

export function ArtifactRail() {
  const { state, dispatch, goView } = useBuild()
  if (!state.railOpen) return null

  const g = buildArtifactGraph(state.track, state.done)
  const doneNodes = g.nodes.filter((n) => n.done)
  const byCat = new Map<ArtifactCategory, typeof g.nodes>()
  for (const n of g.nodes) {
    if (!byCat.has(n.category)) byCat.set(n.category, [])
    byCat.get(n.category)!.push(n)
  }

  return (
    <aside className="m-rail m-rail-drawer" aria-label="Artifacts">
      <div className="m-rail-head m-mono">
        <span>Artifacts · {doneNodes.length}</span>
        <button className="m-rail-close" onClick={() => dispatch({ type: 'TOGGLE_RAIL' })} aria-label="Close">✕</button>
      </div>
      <div className="m-rail-body">
        {CATEGORY_ORDER.filter((c) => byCat.has(c)).map((cat) => {
          const nodes = byCat.get(cat)!
          const doneInCat = nodes.filter((n) => n.done).length
          return (
            <div key={cat} className="m-rail-group">
              <div className="m-rail-cat m-mono">{cat} <span className="m-rail-cat-count">{doneInCat}/{nodes.length}</span></div>
              {nodes.map((n) => (
                <button
                  key={n.id}
                  className={`m-rail-item ${n.done ? 'is-done' : 'is-upcoming'} ${state.view === n.id ? 'is-current' : ''}`}
                  disabled={!n.done}
                  onClick={() => n.done && goView(n.id as ArtifactView)}
                >
                  <span className={`st ${n.done ? 'is-done' : 'is-upcoming'}`} />
                  <span className="m-rail-item-name">{n.label}</span>
                </button>
              ))}
            </div>
          )
        })}
      </div>
      <div className="m-rail-foot">
        <button className="btn-ghost" onClick={() => goView('graph' as ArtifactView)}>Open the artifact graph →</button>
      </div>
    </aside>
  )
}
