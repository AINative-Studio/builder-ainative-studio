/**
 * Unit tests for the generation-mode selector and Issue #11 quality evaluator.
 */
import { describe, it, expect } from 'vitest'
import {
  selectGenerationMode,
  useSubagents,
  evaluateGenerationQuality,
  GENERATION_MAX_TIME_MS,
  ISSUE_11_TEST_PROMPTS,
} from '@/lib/agent/generation-mode'

describe('selectGenerationMode', () => {
  it('returns subagents only for the exact string "true"', () => {
    expect(selectGenerationMode({ USE_SUBAGENTS: 'true' })).toBe('subagents')
    expect(selectGenerationMode({ USE_SUBAGENTS: 'TRUE' })).toBe('standard')
    expect(selectGenerationMode({ USE_SUBAGENTS: '1' })).toBe('standard')
    expect(selectGenerationMode({ USE_SUBAGENTS: 'false' })).toBe('standard')
    expect(selectGenerationMode({})).toBe('standard')
  })

  it('useSubagents mirrors selectGenerationMode', () => {
    expect(useSubagents({ USE_SUBAGENTS: 'true' })).toBe(true)
    expect(useSubagents({ USE_SUBAGENTS: 'nope' })).toBe(false)
  })
})

describe('evaluateGenerationQuality', () => {
  const ok = 'export default function A(){ return null }'

  it('passes for valid code within the time budget', () => {
    const r = evaluateGenerationQuality({
      componentCode: ok,
      validationPassed: true,
      generationTimeMs: 5000,
    })
    expect(r.passed).toBe(true)
    expect(r.failures).toEqual([])
  })

  it('collects every failing criterion', () => {
    const r = evaluateGenerationQuality({
      componentCode: '   ',
      validationPassed: false,
      generationTimeMs: GENERATION_MAX_TIME_MS + 100,
    })
    expect(r.passed).toBe(false)
    expect(r.failures).toHaveLength(3)
  })

  it('treats exactly the budget boundary as a failure', () => {
    const r = evaluateGenerationQuality({
      componentCode: ok,
      validationPassed: true,
      generationTimeMs: GENERATION_MAX_TIME_MS,
    })
    expect(r.passed).toBe(false)
  })
})

describe('ISSUE_11_TEST_PROMPTS', () => {
  it('contains the five canonical prompts from the issue', () => {
    expect(ISSUE_11_TEST_PROMPTS).toHaveLength(5)
    expect(ISSUE_11_TEST_PROMPTS).toContain('Create a landing page for a SaaS product')
  })
})
