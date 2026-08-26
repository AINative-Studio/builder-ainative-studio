import { describe, it, expect } from 'vitest'
import { selectModelForComplexity, modelSelectionReport } from '@/lib/build/model-select'

describe('model-select (#306) — complexity-driven, quality-first', () => {
  it('maps each tier to its default model', () => {
    expect(selectModelForComplexity('simple', { env: {} })).toBe('claude-sonnet-4.5')
    expect(selectModelForComplexity('medium', { env: {} })).toBe('claude-sonnet-4.6')
    expect(selectModelForComplexity('complex', { env: {} })).toBe('claude-opus-4.6')
  })

  it('bumps a multi-file medium idea to the complex model', () => {
    expect(selectModelForComplexity('medium', { wantsMultiFile: true, env: {} })).toBe('claude-opus-4.6')
    // simple + multiFile is NOT bumped (only medium→complex).
    expect(selectModelForComplexity('simple', { wantsMultiFile: true, env: {} })).toBe('claude-sonnet-4.5')
  })

  it('env override wins over the default (retune without deploy)', () => {
    expect(selectModelForComplexity('complex', { env: { CODY_MODEL_COMPLEX: 'claude-opus-4.5' } })).toBe('claude-opus-4.5')
    expect(selectModelForComplexity('simple', { env: { CODY_MODEL_SIMPLE: 'claude-sonnet-4.6' } })).toBe('claude-sonnet-4.6')
  })

  it('override applies to the BUMPED tier, not the raw tier', () => {
    // medium+multiFile bumps to complex, so the COMPLEX override applies.
    expect(selectModelForComplexity('medium', { wantsMultiFile: true, env: { CODY_MODEL_COMPLEX: 'x' } })).toBe('x')
  })

  it('report describes the selection', () => {
    expect(modelSelectionReport('complex', false, 'claude-opus-4.6')).toMatch(/complex → claude-opus-4.6/)
    expect(modelSelectionReport('medium', true, 'claude-opus-4.6')).toMatch(/bumped medium→complex/)
  })
})
