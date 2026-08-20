'use client'

/**
 * Artifact Graph (#225 §23, wired #234) — dotted-grid canvas with SVG bezier
 * edges, laid out L→R by composition order. Built from the REAL artifacts in the
 * current build (buildArtifactGraph on the active track + done map), not a
 * hardcoded company-only map. Node status reflects actual generation.
 */

import { useBuild } from '@/contexts/build-context'
import { buildArtifactGraph } from '@/lib/build/artifact-graph'

const CW = 176, CH = 88, GX = 56, GY = 34

export function Graph() {
  const { state } = useBuild()
  const g = buildArtifactGraph(state.track, state.done)
  const doneCount = g.nodes.filter((n) => n.done).length

  const pos = (col: number, row: number) => ({ x: col * (CW + GX) + 16, y: row * (CH + GY) + 16 })
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]))
  const width = g.cols * (CW + GX)
  const height = g.rows * (CH + GY)

  return (
    <>
      <p className="m-artifact-meta m-mono">
        {g.nodes.length} artifacts · {doneCount} shipped · left to right is composition order
      </p>
      <div className="m-graph-canvas" style={{ minWidth: width, height }}>
        <svg className="m-graph-edges" width={width} height={height}>
          {g.edges.map(({ from, to }) => {
            const a = byId[from], b = byId[to]
            if (!a || !b) return null
            const pa = pos(a.col, a.row), pb = pos(b.col, b.row)
            const x1 = pa.x + CW, y1 = pa.y + CH / 2, x2 = pb.x, y2 = pb.y + CH / 2
            const mx = (x1 + x2) / 2
            return <path key={`${from}-${to}`} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} className="m-graph-edge" />
          })}
        </svg>
        {g.nodes.map((n) => {
          const p = pos(n.col, n.row)
          return (
            <div key={n.id} className="m-graph-node" style={{ left: p.x, top: p.y, width: CW, height: CH }}>
              <span className={`st ${n.done ? 'is-done' : 'is-upcoming'}`}>{n.done ? 'shipped' : 'queued'}</span>
              <span className="m-graph-node-name">{n.label}</span>
              <span className="m-mono m-graph-node-cat">{n.category}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}
