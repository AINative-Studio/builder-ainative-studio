/**
 * Trajectory DAG explainer (#347 slice 4). The offline half of the fork/merge
 * DAG: read cody_trajectories rows, reconstruct the tree via parent_traj /
 * parent_step, and render it — closing the "stop_reason captured but unused" gap
 * (each node now shows its reward AND its stop_reason in context of the tree).
 *
 * This module is PURE (rows in → tree/text out, no network) so it's fully unit
 * tested. scripts/traj-explain.ts is the thin ZeroDB-reading + optional-LLM-
 * narration wrapper around it.
 */

/** A cody_trajectories row (the fields the explainer needs; others ignored). */
export interface TrajRow {
  traj_id: string
  parent_traj: string | null
  parent_step: number | null
  node_role?: 'root' | 'fork' | string
  chat_id?: string
  task?: string
  model?: string
  reward?: 0 | 1 | number | null
  stop_reason?: string | null
  is_error?: boolean
  created_at?: string
}

export interface TrajNode {
  row: TrajRow
  children: TrajNode[]
}

export interface TrajTree {
  /** The root trajectory id (parent_traj === null). */
  rootId: string
  root: TrajNode
  /** Total nodes in this tree (root + all forks). */
  size: number
}

/**
 * Group flat rows into fork trees. A row is a ROOT when parent_traj is null (or
 * missing); every other row attaches under the node whose traj_id === its
 * parent_traj. Orphans (parent not present in the set) are re-homed under their
 * own synthesized root so nothing is silently dropped. Latest-wins on duplicate
 * traj_id (a re-run of the same node).
 */
export function buildTrajTrees(rows: TrajRow[]): TrajTree[] {
  // De-dupe by traj_id, latest created_at wins (mirrors resolveApp latest-wins).
  const byId = new Map<string, TrajRow>()
  for (const r of rows) {
    if (!r?.traj_id) continue
    const prev = byId.get(r.traj_id)
    if (!prev || (r.created_at || '').localeCompare(prev.created_at || '') > 0) byId.set(r.traj_id, r)
  }

  const nodes = new Map<string, TrajNode>()
  for (const row of byId.values()) nodes.set(row.traj_id, { row, children: [] })

  const roots: TrajNode[] = []
  for (const node of nodes.values()) {
    const parentId = node.row.parent_traj
    if (parentId == null) {
      roots.push(node)
      continue
    }
    const parent = nodes.get(parentId)
    if (parent) {
      parent.children.push(node)
    } else {
      // Orphan: parent row absent from the set. Don't drop it — treat as a root.
      roots.push(node)
    }
  }

  // Deterministic ordering: children by parent_step then traj_id.
  const sortChildren = (n: TrajNode) => {
    n.children.sort((a, b) => {
      const sa = a.row.parent_step ?? 0
      const sb = b.row.parent_step ?? 0
      return sa - sb || a.row.traj_id.localeCompare(b.row.traj_id)
    })
    n.children.forEach(sortChildren)
  }

  const count = (n: TrajNode): number => 1 + n.children.reduce((s, c) => s + count(c), 0)

  return roots
    .map((root) => {
      sortChildren(root)
      return { rootId: root.row.traj_id, root, size: count(root) }
    })
    .sort((a, b) => a.rootId.localeCompare(b.rootId))
}

/** One-line label for a node: id, role, reward, stop_reason. */
export function formatNodeLine(node: TrajNode): string {
  const r = node.row
  const reward = r.reward == null ? '?' : String(r.reward)
  const stop = r.stop_reason ? ` stop=${r.stop_reason}` : ''
  const role = r.node_role || (r.parent_traj == null ? 'root' : 'fork')
  const step = r.parent_step != null ? `@${r.parent_step}` : ''
  return `${r.traj_id} [${role}${step}] reward=${reward}${stop}`
}

/** Render one tree as an indented ASCII outline. */
export function renderTree(tree: TrajTree): string {
  const lines: string[] = []
  const walk = (node: TrajNode, depth: number) => {
    lines.push(`${'  '.repeat(depth)}${depth > 0 ? '└─ ' : ''}${formatNodeLine(node)}`)
    for (const c of node.children) walk(c, depth + 1)
  }
  walk(tree.root, 0)
  return lines.join('\n')
}

/** Summary stats across all trees (for the report header). */
export interface TrajSummary {
  trees: number
  nodes: number
  roots: number
  forks: number
  rewardedForks: number
  failedForks: number
}

export function summarize(trees: TrajTree[]): TrajSummary {
  let nodes = 0
  let forks = 0
  let rewardedForks = 0
  let failedForks = 0
  const walk = (n: TrajNode) => {
    nodes++
    if (n.row.parent_traj != null) {
      forks++
      if (n.row.reward === 1) rewardedForks++
      if (n.row.reward === 0 || n.row.is_error) failedForks++
    }
    n.children.forEach(walk)
  }
  trees.forEach((t) => walk(t.root))
  return { trees: trees.length, nodes, roots: trees.length, forks, rewardedForks, failedForks }
}

/** Full text report: header stats + every tree. */
export function explainTrajectories(rows: TrajRow[]): string {
  const trees = buildTrajTrees(rows)
  const s = summarize(trees)
  const header = [
    `Trajectory DAG — ${s.trees} tree(s), ${s.nodes} node(s)`,
    `forks=${s.forks} (reward=1: ${s.rewardedForks}, failed: ${s.failedForks})`,
    '',
  ].join('\n')
  return header + trees.map(renderTree).join('\n\n')
}
