import { describe, it, expect } from 'vitest'
import { buildReducer, initialBuildState } from '@/lib/build/state'

describe('growthIntent (#BLD-10)', () => {
  it('defaults to false', () => {
    expect(initialBuildState.growthIntent).toBe(false)
  })

  it('SET_GROWTH_INTENT sets the flag', () => {
    const next = buildReducer(initialBuildState, { type: 'SET_GROWTH_INTENT', value: true })
    expect(next.growthIntent).toBe(true)
  })

  it('SET_GROWTH_INTENT can clear the flag back to false', () => {
    const grown = buildReducer(initialBuildState, { type: 'SET_GROWTH_INTENT', value: true })
    const cleared = buildReducer(grown, { type: 'SET_GROWTH_INTENT', value: false })
    expect(cleared.growthIntent).toBe(false)
  })
})
