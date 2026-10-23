import { describe, it, expect } from 'vitest'
import {
  COMPANY_GROW_BUSINESS_QUESTIONS,
  SITE_URL_QUESTION_ID,
} from '@/lib/build/kickoff-questions'

/**
 * #1306 — growth-intent kickoff gains a real, optional way for the founder
 * to supply their existing site URL, so KickoffQuestions.tsx can run a real
 * (light) assessment on it. Added as a 4th question on the existing
 * COMPANY_GROW_BUSINESS_QUESTIONS set (same UI pattern: tap-to-answer /
 * free text / "Not sure yet" skip — this question is always skippable).
 */
describe('COMPANY_GROW_BUSINESS_QUESTIONS — existing-site URL (#1306)', () => {
  it('has exactly 4 questions now (3 original + 1 site-url)', () => {
    expect(COMPANY_GROW_BUSINESS_QUESTIONS).toHaveLength(4)
  })

  it('the 4th question asks for the existing site URL and has no suggestion buttons (free text only)', () => {
    const q = COMPANY_GROW_BUSINESS_QUESTIONS[3]
    expect(q.id).toBe(SITE_URL_QUESTION_ID)
    expect(q.text.toLowerCase()).toContain('website')
    expect(q.suggestions).toEqual([])
  })

  it('the first 3 questions are unchanged from before', () => {
    expect(COMPANY_GROW_BUSINESS_QUESTIONS[0].id).toBe('today')
    expect(COMPANY_GROW_BUSINESS_QUESTIONS[1].id).toBe('blocker')
    expect(COMPANY_GROW_BUSINESS_QUESTIONS[2].id).toBe('customers')
  })
})
