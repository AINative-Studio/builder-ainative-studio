'use client'

/** Artifact Graph (#225, §23) — dotted-grid canvas, SVG bezier edges, L→R composition order. */

import { useBuild } from '@/contexts/build-context'

// node id -> [col,row] on a simple grid; edges = dependency order.
const NODES: Record<string, { label: string; cat: string; col: number; row: number }> = {
  thesis: { label: 'Venture Thesis', cat: 'Thesis', col: 0, row: 1 },
  wedge: { label: 'Wedge', cat: 'Thesis', col: 1, row: 1 },
  businessModel: { label: 'Business Model', cat: 'Ops', col: 2, row: 0 },
  positioning: { label: 'Positioning', cat: 'Brand', col: 2, row: 2 },
  landing: { label: 'Landing', cat: 'Brand', col: 3, row: 2 },
  plan30: { label: '30-Day Plan', cat: 'Ops', col: 3, row: 0 },
  pipeline: { label: 'Pipeline', cat: 'Sales', col: 4, row: 1 },
}
const EDGES: Array<[string, string]> = [
  ['thesis', 'wedge'], ['wedge', 'businessModel'], ['wedge', 'positioning'],
  ['positioning', 'landing'], ['businessModel', 'plan30'], ['landing', 'pipeline'], ['plan30', 'pipeline'],
]
const CW = 190, CH = 92, GX = 60, GY = 40

export function Graph() {
  const { views } = useBuild()
  const pos = (id: string) => {
    const n = NODES[id]
    return { x: n.col * (CW + GX) + 20, y: n.row * (CH + GY) + 20 }
  }
  const width = 5 * (CW + GX)
  const height = 3 * (CH + GY)

  return (
    <>
      <p className="m-artifact-meta m-mono">{views.length} artifacts · structured layout · left to right is composition order</p>
      <div className="m-graph-canvas" style={{ minWidth: width, height }}>
        <svg className="m-graph-edges" width={width} height={height}>
          {EDGES.map(([a, b]) => {
            const pa = pos(a), pb = pos(b)
            const x1 = pa.x + CW, y1 = pa.y + CH / 2, x2 = pb.x, y2 = pb.y + CH / 2
            const mx = (x1 + x2) / 2
            return <path key={`${a}-${b}`} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} className="m-graph-edge" />
          })}
        </svg>
        {Object.entries(NODES).map(([id, n]) => {
          const p = pos(id)
          return (
            <div key={id} className="m-graph-node" style={{ left: p.x, top: p.y, width: CW, height: CH }}>
              <span className="st is-done">shipped</span>
              <span className="m-graph-node-name">{n.label}</span>
              <span className="m-mono m-graph-node-cat">{n.cat}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}
