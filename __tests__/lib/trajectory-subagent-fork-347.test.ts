import { describe, it, expect } from 'vitest'
import { subagentForkRecord } from '@/lib/agent/trajectory-capture'

/**
 * #347 slice 2 — the orchestrator (subagents.ts) forks a trajectory per subagent
 * (design/code/validation) under the parent run's traj_id, so the DAG records
 * parent → [design, code, validation] with provenance pointers. These lock the
 * pure builder that turns a subagent result into a forked TrajectoryRecord.
 */

const base = {
  parentTrajId: 'run42',
  chatId: 'run42',
  task: 'build a kanban board',
  model: 'claude-sonnet-4-5',
  createdAt: '2026-08-28T00:00:00.000Z',
  durationMs: 1234,
}

describe('subagentForkRecord (#347 slice 2)', () => {
  it('forks under the parent with a per-subagent traj_id + parent_step', () => {
    const r = subagentForkRecord({ ...base, parentStep: 1, subagentType: 'design', output: 'spec', success: true })
    expect(r.traj_id).toBe('run42.design')
    expect(r.parent_traj).toBe('run42')
    expect(r.parent_step).toBe(1)
    expect(r.node_role).toBe('fork')
  })

  it('three subagents fork at distinct parent steps under one parent', () => {
    const design = subagentForkRecord({ ...base, parentStep: 1, subagentType: 'design', output: 'd', success: true })
    const code = subagentForkRecord({ ...base, parentStep: 2, subagentType: 'code', output: 'c', success: true })
    const val = subagentForkRecord({ ...base, parentStep: 3, subagentType: 'validation', output: 'v', success: false })
    expect([design, code, val].map((r) => r.traj_id)).toEqual(['run42.design', 'run42.code', 'run42.validation'])
    expect([design, code, val].map((r) => r.parent_step)).toEqual([1, 2, 3])
    // all share the same parent → one tree
    expect(new Set([design, code, val].map((r) => r.parent_traj))).toEqual(new Set(['run42']))
  })

  it('success maps to reward 1, failure to reward 0 + is_error', () => {
    const ok = subagentForkRecord({ ...base, parentStep: 2, subagentType: 'code', output: 'x', success: true })
    const bad = subagentForkRecord({ ...base, parentStep: 2, subagentType: 'code', output: '', success: false })
    expect(ok.verify.reward).toBe(1)
    expect(ok.is_error).toBe(false)
    expect(bad.verify.reward).toBe(0)
    expect(bad.is_error).toBe(true)
  })

  it('records the subagent output as a single step tagged with the subagent tool', () => {
    const r = subagentForkRecord({ ...base, parentStep: 1, subagentType: 'design', output: 'the spec text', success: true })
    expect(r.steps).toHaveLength(1)
    expect(r.steps[0].tool).toBe('subagent:design')
    expect(r.steps[0].text).toBe('the spec text')
    expect(r.num_turns).toBe(1)
  })

  it('is pure/deterministic — same inputs produce an equal record', () => {
    const a = subagentForkRecord({ ...base, parentStep: 1, subagentType: 'design', output: 'd', success: true })
    const b = subagentForkRecord({ ...base, parentStep: 1, subagentType: 'design', output: 'd', success: true })
    expect(a).toEqual(b)
  })

  it('truncates very long output + task (bounded record size)', () => {
    const big = 'x'.repeat(20000)
    const r = subagentForkRecord({ ...base, task: big, parentStep: 2, subagentType: 'code', output: big, success: true })
    expect(r.steps[0].text!.length).toBeLessThanOrEqual(8000)
    expect(r.task.length).toBeLessThanOrEqual(4000)
  })
})
