import { describe, it, expect } from 'vitest'
import { wantsFullDiscipline, computeAgentTurnBudget } from '@/lib/agent/claude-agent'

/**
 * #350 — the heavy discipline (plan/review + MCP + test blocks) and the full
 * turn budget must ONLY apply to complex builds. Stacking them on every build
 * made the agent run away to max_tokens (~13min, turns=1) and ship the seed
 * scaffold. These lock the complexity gating so it can't silently regress.
 */

describe('wantsFullDiscipline (#350)', () => {
  it('complex → full discipline', () => {
    expect(wantsFullDiscipline('complex')).toBe(true)
  })
  it('simple and medium → lean prompt (no heavy blocks)', () => {
    expect(wantsFullDiscipline('simple')).toBe(false)
    expect(wantsFullDiscipline('medium')).toBe(false)
  })
  it('undefined → full discipline (non-classifying callers unchanged)', () => {
    expect(wantsFullDiscipline(undefined)).toBe(true)
  })
})

describe('computeAgentTurnBudget (#350)', () => {
  it('complex build gets 12 base turns + plan-review headroom', () => {
    const { maxTurns, planReview } = computeAgentTurnBudget('complex')
    expect(planReview).toBe(true)
    expect(maxTurns).toBeGreaterThan(12) // 12 + headroom
  })

  it('simple build gets the tighter 6-turn lean budget with NO plan-review', () => {
    const { maxTurns, planReview } = computeAgentTurnBudget('simple')
    expect(planReview).toBe(false)
    expect(maxTurns).toBe(6) // no plan-review headroom added
  })

  it('medium build is also lean (6 turns, no review)', () => {
    const { maxTurns, planReview } = computeAgentTurnBudget('medium')
    expect(planReview).toBe(false)
    expect(maxTurns).toBe(6)
  })

  it('a simple build has a STRICTLY smaller turn budget than a complex one (runaway guard)', () => {
    expect(computeAgentTurnBudget('simple').maxTurns)
      .toBeLessThan(computeAgentTurnBudget('complex').maxTurns)
  })

  it('an explicit maxTurns override is honored (verify/repair paths)', () => {
    expect(computeAgentTurnBudget('complex', 6, false).maxTurns).toBe(6) // no review headroom when planReview:false
    expect(computeAgentTurnBudget('simple', 3).maxTurns).toBe(3)
  })

  it('planReview:false suppresses the review even on complex builds', () => {
    expect(computeAgentTurnBudget('complex', undefined, false).planReview).toBe(false)
  })
})
