import { describe, it, expect } from 'vitest'
import { buildReducer, initialBuildState } from '@/lib/build/state'

describe('ecommerceIntent (#1182)', () => {
  it('defaults to false', () => {
    expect(initialBuildState.ecommerceIntent).toBe(false)
  })

  it('SET_ECOMMERCE_INTENT sets the flag', () => {
    const next = buildReducer(initialBuildState, { type: 'SET_ECOMMERCE_INTENT', value: true })
    expect(next.ecommerceIntent).toBe(true)
  })

  it('SET_ECOMMERCE_INTENT can clear the flag back to false', () => {
    const on = buildReducer(initialBuildState, { type: 'SET_ECOMMERCE_INTENT', value: true })
    const off = buildReducer(on, { type: 'SET_ECOMMERCE_INTENT', value: false })
    expect(off.ecommerceIntent).toBe(false)
  })

  it('is independent of growthIntent — setting one never touches the other', () => {
    const grown = buildReducer(initialBuildState, { type: 'SET_GROWTH_INTENT', value: true })
    const grownAndEcommerce = buildReducer(grown, { type: 'SET_ECOMMERCE_INTENT', value: true })
    expect(grownAndEcommerce.growthIntent).toBe(true)
    expect(grownAndEcommerce.ecommerceIntent).toBe(true)
  })
})
