import { describe, it, expect } from 'vitest'
import {
  FOUNDER_TYPE_QUESTIONS,
  classifyFounderType,
  type FounderTypeAnswers,
} from '@/lib/build/founder-type'

/**
 * #1311 — a small, deterministic (NOT an LLM call) founder-type classifier.
 * 5 questions, each option tagged toward one of a fixed label set:
 * 'architect' | 'hustler' | 'operator'. classifyFounderType maps a set of
 * answers to the label with the most votes; ties break toward 'operator'
 * (a safe, no-extra-friction middle default) — documented and tested below.
 */

describe('FOUNDER_TYPE_QUESTIONS (#1311)', () => {
  it('has exactly 5 questions', () => {
    expect(FOUNDER_TYPE_QUESTIONS).toHaveLength(5)
  })

  it('every question has a non-empty id, text, and at least 2 options', () => {
    for (const q of FOUNDER_TYPE_QUESTIONS) {
      expect(q.id).toBeTruthy()
      expect(q.text).toBeTruthy()
      expect(q.options.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('every option has a label, value, and a founder-type weight', () => {
    for (const q of FOUNDER_TYPE_QUESTIONS) {
      for (const opt of q.options) {
        expect(opt.value).toBeTruthy()
        expect(opt.label).toBeTruthy()
        expect(['architect', 'hustler', 'operator']).toContain(opt.type)
      }
    }
  })

  it('question ids are unique', () => {
    const ids = FOUNDER_TYPE_QUESTIONS.map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('classifyFounderType — deterministic mapping (#1311)', () => {
  it('classifies as architect when a majority of answers point to architect', () => {
    const answers: FounderTypeAnswers = {
      pace: 'architect', review: 'architect', risk: 'architect',
      delegation: 'hustler', detail: 'operator',
    }
    expect(classifyFounderType(answers)).toBe('architect')
  })

  it('classifies as hustler when a majority of answers point to hustler', () => {
    const answers: FounderTypeAnswers = {
      pace: 'hustler', review: 'hustler', risk: 'hustler',
      delegation: 'architect', detail: 'operator',
    }
    expect(classifyFounderType(answers)).toBe('hustler')
  })

  it('classifies as operator when a majority of answers point to operator', () => {
    const answers: FounderTypeAnswers = {
      pace: 'operator', review: 'operator', risk: 'operator',
      delegation: 'architect', detail: 'hustler',
    }
    expect(classifyFounderType(answers)).toBe('operator')
  })

  it('is a pure function — same input always yields the same output', () => {
    const answers: FounderTypeAnswers = {
      pace: 'architect', review: 'hustler', risk: 'operator',
      delegation: 'architect', detail: 'hustler',
    }
    expect(classifyFounderType(answers)).toBe(classifyFounderType({ ...answers }))
  })

  it('breaks a tie toward operator (documented default — least extra friction)', () => {
    const answers: FounderTypeAnswers = {
      pace: 'architect', review: 'architect',
      delegation: 'hustler', detail: 'hustler',
      risk: 'operator',
    }
    // 2 architect, 2 hustler, 1 operator — no outright majority; operator wins ties.
    expect(classifyFounderType(answers)).toBe('operator')
  })

  it('defaults unanswered questions to not counting toward any type', () => {
    const answers: FounderTypeAnswers = { pace: 'architect', review: 'architect' }
    expect(classifyFounderType(answers)).toBe('architect')
  })

  it('returns operator when given no answers at all (safe default)', () => {
    expect(classifyFounderType({})).toBe('operator')
  })
})
