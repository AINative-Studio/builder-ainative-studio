import { describe, it, expect } from 'vitest'
import { getQuestionsForView, composeFeedbackFromAnswers } from '@/lib/build/cody-questions'
import { FEEDBACK_MAX_CHARS } from '@/lib/build/artifact-edit'

describe('getQuestionsForView (#BLD-06.3)', () => {
  it('returns at most 3 questions for thesis', () => {
    const qs = getQuestionsForView('thesis')
    expect(qs.length).toBeLessThanOrEqual(3)
    expect(qs.length).toBeGreaterThan(0)
  })

  it('every question has 2-4 suggestions plus always allows free text', () => {
    const qs = getQuestionsForView('thesis')
    for (const q of qs) {
      expect(q.suggestions.length).toBeGreaterThanOrEqual(2)
      expect(q.suggestions.length).toBeLessThanOrEqual(4)
      expect(q.allowFreeText).toBe(true)
    }
  })

  it('returns an empty array for a view with no authored question set, never throws', () => {
    expect(getQuestionsForView('swarm')).toEqual([])
  })
})

describe('composeFeedbackFromAnswers (#BLD-06.3)', () => {
  it('composes a Q&A feedback string from answered questions only', () => {
    const qs = getQuestionsForView('thesis')
    const answers = { [qs[0].id]: qs[0].suggestions[0] }
    const fb = composeFeedbackFromAnswers(qs, answers)
    expect(fb).toContain(qs[0].suggestions[0])
  })

  it('skips unanswered and "Not sure yet" questions entirely', () => {
    const qs = getQuestionsForView('thesis')
    const fb = composeFeedbackFromAnswers(qs, {})
    expect(fb).toBe('')
  })

  it('never exceeds FEEDBACK_MAX_CHARS, clipped at a whole-question boundary', () => {
    const qs = getQuestionsForView('thesis')
    const longAnswer = 'x'.repeat(FEEDBACK_MAX_CHARS)
    const answers = Object.fromEntries(qs.map((q) => [q.id, longAnswer]))
    const fb = composeFeedbackFromAnswers(qs, answers)
    expect(fb.length).toBeLessThanOrEqual(FEEDBACK_MAX_CHARS)
    expect(fb.endsWith('"""') || fb === '').toBe(true)
  })
})
