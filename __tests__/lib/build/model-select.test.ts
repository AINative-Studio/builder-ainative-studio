import { describe, it, expect } from 'vitest'
import { selectModelForComplexity, modelSelectionReport } from '@/lib/build/model-select'

describe('model-select (#306) — complexity-driven, quality-first', () => {
  const SONNET45 = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
  const SONNET46 = 'us.anthropic.claude-sonnet-4-6'
  const OPUS46 = 'us.anthropic.claude-opus-4-6-v1'

  it('maps each tier to its default Bedrock profile — Opus ONLY for complex', () => {
    expect(selectModelForComplexity('simple', { env: {} })).toBe(SONNET45)
    expect(selectModelForComplexity('medium', { env: {} })).toBe(SONNET46)
    expect(selectModelForComplexity('complex', { env: {} })).toBe(OPUS46)
  })

  it('a simple app does NOT get Opus (cost guard)', () => {
    expect(selectModelForComplexity('simple', { env: {} })).not.toContain('opus')
    expect(selectModelForComplexity('medium', { env: {} })).not.toContain('opus')
  })

  it('a multi-file idea bumps to Opus from ANY tier (analyzeComplexity under-scores terse complex ideas)', () => {
    // A terse "a CRM …" scores simple/medium but wantsMultiFile is the reliable
    // "this is complex" signal → Opus regardless of the flaky complexity score.
    expect(selectModelForComplexity('medium', { wantsMultiFile: true, env: {} })).toBe(OPUS46)
    expect(selectModelForComplexity('simple', { wantsMultiFile: true, env: {} })).toBe(OPUS46)
    // Without the multi-file signal, tiers stay on their cheap defaults.
    expect(selectModelForComplexity('simple', { env: {} })).toBe(SONNET45)
    expect(selectModelForComplexity('medium', { env: {} })).toBe(SONNET46)
  })

  it('env override wins over the default (retune without deploy)', () => {
    expect(selectModelForComplexity('complex', { env: { CODY_MODEL_COMPLEX: 'x-profile' } })).toBe('x-profile')
    expect(selectModelForComplexity('simple', { env: { CODY_MODEL_SIMPLE: SONNET46 } })).toBe(SONNET46)
  })

  it('override applies to the BUMPED tier, not the raw tier', () => {
    expect(selectModelForComplexity('medium', { wantsMultiFile: true, env: { CODY_MODEL_COMPLEX: 'x' } })).toBe('x')
  })

  it('report describes the selection', () => {
    expect(modelSelectionReport('complex', false, OPUS46)).toMatch(/complex →/)
    expect(modelSelectionReport('medium', true, OPUS46)).toMatch(/bumped medium→complex/)
  })
})
