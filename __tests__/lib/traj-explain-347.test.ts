import { describe, it, expect } from 'vitest'
import {
  buildTrajTrees,
  summarize,
  renderTree,
  formatNodeLine,
  explainTrajectories,
  type TrajRow,
} from '@/lib/agent/traj-explain'

/**
 * #347 slice 4 — offline explain tool. These lock the PURE DAG reconstruction:
 * flat cody_trajectories rows → fork trees via parent_traj/parent_step, with
 * reward + stop_reason surfaced (closing the 'stop_reason captured but unused'
 * gap). The ZeroDB read + LLM narration live in scripts/traj-explain.ts.
 */

function row(p: Partial<TrajRow> & { traj_id: string }): TrajRow {
  return { parent_traj: null, parent_step: null, ...p }
}

// A full run: root + 3 subagent forks, code failed then a retry succeeded.
const ROWS: TrajRow[] = [
  row({ traj_id: 'run1', node_role: 'root', reward: 1, stop_reason: 'end_turn' }),
  row({ traj_id: 'run1.design', parent_traj: 'run1', parent_step: 1, node_role: 'fork', reward: 1 }),
  row({ traj_id: 'run1.code', parent_traj: 'run1', parent_step: 2, node_role: 'fork', reward: 0, is_error: true }),
  row({ traj_id: 'run1.validation', parent_traj: 'run1', parent_step: 3, node_role: 'fork', reward: 0 }),
  row({ traj_id: 'run1.code.retry1', parent_traj: 'run1', parent_step: 2, node_role: 'fork', reward: 1 }),
]

describe('buildTrajTrees (#347 slice 4)', () => {
  it('groups a root + its forks into ONE tree', () => {
    const trees = buildTrajTrees(ROWS)
    expect(trees).toHaveLength(1)
    expect(trees[0].rootId).toBe('run1')
    expect(trees[0].size).toBe(5) // root + 4 forks
  })

  it('attaches every fork under its parent (children reconstructed)', () => {
    const [tree] = buildTrajTrees(ROWS)
    const childIds = tree.root.children.map((c) => c.row.traj_id)
    expect(childIds).toContain('run1.design')
    expect(childIds).toContain('run1.code')
    expect(childIds).toContain('run1.code.retry1')
    expect(tree.root.children).toHaveLength(4)
  })

  it('orders children by parent_step (deterministic)', () => {
    const [tree] = buildTrajTrees(ROWS)
    const steps = tree.root.children.map((c) => c.row.parent_step)
    // non-decreasing
    expect([...steps]).toEqual([...steps].sort((a, b) => (a ?? 0) - (b ?? 0)))
  })

  it('separate roots produce separate trees', () => {
    const trees = buildTrajTrees([
      row({ traj_id: 'a', reward: 1 }),
      row({ traj_id: 'b', reward: 0 }),
      row({ traj_id: 'a.code', parent_traj: 'a', parent_step: 2 }),
    ])
    expect(trees.map((t) => t.rootId)).toEqual(['a', 'b'])
  })

  it('an ORPHAN fork (missing parent) is not dropped — re-homed as a root', () => {
    const trees = buildTrajTrees([row({ traj_id: 'x.code', parent_traj: 'x', parent_step: 2 })])
    expect(trees).toHaveLength(1)
    expect(trees[0].rootId).toBe('x.code')
  })

  it('de-dupes duplicate traj_id, latest created_at wins', () => {
    const trees = buildTrajTrees([
      row({ traj_id: 'r', reward: 0, created_at: '2026-08-28T00:00:00Z' }),
      row({ traj_id: 'r', reward: 1, created_at: '2026-08-28T01:00:00Z' }),
    ])
    expect(trees[0].root.row.reward).toBe(1)
  })
})

describe('summarize + render (#347 slice 4)', () => {
  it('summary counts forks, rewarded, failed', () => {
    const s = summarize(buildTrajTrees(ROWS))
    expect(s.trees).toBe(1)
    expect(s.nodes).toBe(5)
    expect(s.forks).toBe(4)
    expect(s.rewardedForks).toBe(2) // design + code.retry1
    expect(s.failedForks).toBe(2) // code (is_error) + validation (reward 0)
  })

  it('formatNodeLine surfaces reward AND stop_reason (the closed gap)', () => {
    const line = formatNodeLine(buildTrajTrees(ROWS)[0].root)
    expect(line).toContain('run1')
    expect(line).toContain('reward=1')
    expect(line).toContain('stop=end_turn')
  })

  it('renderTree indents forks under the root', () => {
    const text = renderTree(buildTrajTrees(ROWS)[0])
    expect(text.split('\n')[0]).toContain('run1')
    expect(text).toContain('└─ run1.design')
  })

  it('explainTrajectories produces a header + tree text', () => {
    const out = explainTrajectories(ROWS)
    expect(out).toContain('Trajectory DAG — 1 tree(s), 5 node(s)')
    expect(out).toContain('run1.code.retry1')
  })

  it('empty input → zero trees, no crash', () => {
    expect(buildTrajTrees([])).toEqual([])
    expect(explainTrajectories([])).toContain('0 tree(s)')
  })
})
