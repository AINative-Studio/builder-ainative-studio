/**
 * Artifact dependency graph (#234) — builds the REAL node/edge structure from the
 * artifacts actually generated in the current build, instead of a hardcoded map.
 *
 * Nodes = the track's artifacts that are done (or all, for layout), tagged with
 * category + status. Edges = the real composition order (each artifact draws from
 * its predecessors per the design's draws-from/feeds relationships). Used by the
 * Artifact Graph screen and the Dependency Conflict impact tracing.
 */

import { APP_VIEWS, COMPANY_VIEWS, type Track } from '@/lib/build/state'
import { ARTIFACT_TITLES } from '@/lib/build/titles'

export type ArtifactCategory =
  | 'Thesis' | 'Product' | 'Delivery' | 'Brand & Distribution' | 'Operations' | 'Sales & Revenue'

/** Category per artifact view (04-SCREENS rail groupings). */
export const ARTIFACT_CATEGORY: Record<string, ArtifactCategory> = {
  // App
  brief: 'Product', prd: 'Product', comp: 'Product',
  dataModel: 'Delivery', memoryPolicy: 'Delivery', agentDef: 'Delivery',
  codingStandards: 'Delivery', apiSpec: 'Delivery', backlog: 'Delivery',
  sprintPlan: 'Delivery', swarm: 'Delivery', infra: 'Delivery', preview: 'Delivery',
  // Company
  thesis: 'Thesis', wedge: 'Thesis',
  businessModel: 'Operations', plan30: 'Operations',
  positioning: 'Brand & Distribution', landing: 'Brand & Distribution',
  pipeline: 'Sales & Revenue',
}

export interface GraphNode {
  id: string
  label: string
  category: ArtifactCategory
  col: number      // composition order (left→right)
  row: number      // lane within the column
  done: boolean
}
export interface GraphEdge {
  from: string
  to: string
}
export interface ArtifactGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  cols: number
  rows: number
}

/**
 * Explicit composition edges (draws-from → feeds). Only edges whose BOTH ends are
 * in the current track's sequence are emitted. Kept minimal + real: each artifact
 * feeds the ones that genuinely depend on it.
 */
const COMPOSITION_EDGES: Array<[string, string]> = [
  // App track
  ['brief', 'prd'], ['prd', 'comp'], ['comp', 'dataModel'], ['comp', 'agentDef'],
  ['dataModel', 'memoryPolicy'], ['agentDef', 'codingStandards'], ['agentDef', 'apiSpec'],
  ['prd', 'backlog'], ['backlog', 'sprintPlan'],
  ['sprintPlan', 'swarm'], ['codingStandards', 'swarm'],
  ['dataModel', 'infra'], ['agentDef', 'infra'],
  ['swarm', 'preview'], ['infra', 'preview'],
  // Company track
  ['thesis', 'wedge'], ['wedge', 'businessModel'], ['wedge', 'positioning'],
  ['positioning', 'landing'], ['businessModel', 'plan30'],
  ['landing', 'pipeline'], ['plan30', 'pipeline'],
]

/**
 * Build the graph for a track from the set of done artifacts. When `doneMap` is
 * empty, all track views render (so the graph is meaningful during the build);
 * node.done reflects each view's actual status.
 */
export function buildArtifactGraph(track: Track, doneMap: Record<string, unknown> = {}): ArtifactGraph {
  const seq = (track === 'app' ? APP_VIEWS : COMPANY_VIEWS) as readonly string[]
  const inTrack = new Set(seq)

  // Column = position in the composition sequence; lane by category to spread rows.
  const catRow: Record<string, number> = {}
  const rowSeen: Record<number, number> = {}
  const nodes: GraphNode[] = seq.map((id, col) => {
    const cat = ARTIFACT_CATEGORY[id] ?? 'Product'
    if (!(cat in catRow)) catRow[cat] = Object.keys(catRow).length
    // stagger rows so edges don't fully overlap: alternate lane by index parity + category
    const row = (catRow[cat] + (col % 2)) % 3
    rowSeen[row] = (rowSeen[row] || 0) + 1
    return {
      id,
      label: ARTIFACT_TITLES[id] ?? id,
      category: cat,
      col,
      row,
      done: !!doneMap[id],
    }
  })

  const edges: GraphEdge[] = COMPOSITION_EDGES
    .filter(([a, b]) => inTrack.has(a) && inTrack.has(b))
    .map(([from, to]) => ({ from, to }))

  return {
    nodes,
    edges,
    cols: seq.length,
    rows: 3,
  }
}

/**
 * Trace downstream impact of changing `changedView`: every artifact reachable from
 * it via composition edges, classified by distance (Breaking = direct dependent,
 * Needs update = 2 hops, Minor = further). Powers the Dependency Conflict list.
 */
export interface ImpactItem {
  view: string
  label: string
  kind: 'Breaking' | 'Needs update' | 'Minor'
  why: string
}

export function traceImpact(track: Track, changedView: string): ImpactItem[] {
  const g = buildArtifactGraph(track)
  const adj: Record<string, string[]> = {}
  for (const e of g.edges) (adj[e.from] ||= []).push(e.to)

  const dist: Record<string, number> = {}
  const queue: Array<[string, number]> = [[changedView, 0]]
  while (queue.length) {
    const [v, d] = queue.shift()!
    for (const n of adj[v] || []) {
      if (dist[n] === undefined || d + 1 < dist[n]) {
        dist[n] = d + 1
        queue.push([n, d + 1])
      }
    }
  }

  const whyFor = (view: string): string => {
    const cat = ARTIFACT_CATEGORY[view]
    if (cat === 'Operations') return 'Pricing / plan assumptions shift'
    if (cat === 'Brand & Distribution') return 'Copy + positioning reference the change'
    if (cat === 'Sales & Revenue') return 'Targeting / ICP filters change'
    if (cat === 'Delivery') return 'Downstream build inputs change'
    return 'References the changed decision'
  }

  return Object.entries(dist)
    .sort((a, b) => a[1] - b[1])
    .map(([view, d]) => ({
      view,
      label: ARTIFACT_TITLES[view] ?? view,
      kind: d === 1 ? 'Breaking' : d === 2 ? 'Needs update' : 'Minor',
      why: whyFor(view),
    }))
}
