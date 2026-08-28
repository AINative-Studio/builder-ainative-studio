import { describe, it, expect } from 'vitest'
import { planRefork } from '@/lib/agent/trajectory-capture'

/**
 * #347 slice 3 — a failed validation phase RE-FORKS from the last good step
 * instead of dead-ending. planRefork() is the pure decision + provenance minter:
 * it says whether to retry (bounded) and mints the retry chain's provenance.
 */

const base = { parentTrajId: 'run7', lastGoodStep: 2, subagentType: 'code', maxRetries: 2 }

describe('planRefork (#347 slice 3)', () => {
  it('attempt 1 forks from the last good step with a retry1 suffix', () => {
    const p = planRefork({ ...base, attempt: 1 })
    expect(p).not.toBeNull()
    expect(p!.traj_id).toBe('run7.code.retry1')
    expect(p!.parent_traj).toBe('run7')
    expect(p!.parent_step).toBe(2) // re-forks from the last GOOD step, not validation
    expect(p!.node_role).toBe('fork')
  })

  it('attempt 2 mints a distinct retry2 provenance', () => {
    expect(planRefork({ ...base, attempt: 2 })!.traj_id).toBe('run7.code.retry2')
  })

  it('returns null once attempts exceed maxRetries (bounded — no infinite retry)', () => {
    expect(planRefork({ ...base, attempt: 3 })).toBeNull()
    expect(planRefork({ ...base, attempt: 99 })).toBeNull()
  })

  it('returns null for a non-positive attempt (guard)', () => {
    expect(planRefork({ ...base, attempt: 0 })).toBeNull()
  })

  it('respects maxRetries=0 (feature effectively disabled)', () => {
    expect(planRefork({ ...base, maxRetries: 0, attempt: 1 })).toBeNull()
  })

  it('is pure/deterministic — same inputs, same plan', () => {
    expect(planRefork({ ...base, attempt: 1 })).toEqual(planRefork({ ...base, attempt: 1 }))
  })

  it('the retry chain forks all share the parent + last-good step', () => {
    const r1 = planRefork({ ...base, attempt: 1 })!
    const r2 = planRefork({ ...base, attempt: 2 })!
    expect(r1.parent_traj).toBe(r2.parent_traj)
    expect(r1.parent_step).toBe(r2.parent_step)
    expect(r1.traj_id).not.toBe(r2.traj_id)
  })
})
