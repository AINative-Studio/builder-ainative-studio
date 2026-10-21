import { describe, it, expect } from 'vitest'
import {
  getKickoffQuestions,
  COMPANY_ECOMMERCE_QUESTIONS,
  COMPANY_NEW_BUSINESS_QUESTIONS,
  COMPANY_GROW_BUSINESS_QUESTIONS,
  APP_KICKOFF_QUESTIONS,
} from '@/lib/build/kickoff-questions'

/**
 * #1182 — getKickoffQuestions gains a 3rd optional param (isEcommerce) that
 * routes to a new commerce-specific question set when a founder entered via
 * BuildStart.tsx's "Launch an online store" path, checked BEFORE the
 * existing growth/new-business branch (not after) so ecommerce intent wins
 * even if growthIntent also happens to be true.
 */
describe('getKickoffQuestions — ecommerce branch (#1182)', () => {
  it('returns COMPANY_ECOMMERCE_QUESTIONS when isEcommerce is true, regardless of isGrowth', () => {
    expect(getKickoffQuestions('company', false, true)).toBe(COMPANY_ECOMMERCE_QUESTIONS)
    expect(getKickoffQuestions('company', true, true)).toBe(COMPANY_ECOMMERCE_QUESTIONS)
  })

  it('falls back to the existing new/growing-business branches when isEcommerce is false or omitted', () => {
    expect(getKickoffQuestions('company', false, false)).toBe(COMPANY_NEW_BUSINESS_QUESTIONS)
    expect(getKickoffQuestions('company', true, false)).toBe(COMPANY_GROW_BUSINESS_QUESTIONS)
    expect(getKickoffQuestions('company', false)).toBe(COMPANY_NEW_BUSINESS_QUESTIONS)
  })

  it('the app track is unaffected by isEcommerce (app track has its own fixed question set)', () => {
    expect(getKickoffQuestions('app', false, true)).toBe(APP_KICKOFF_QUESTIONS)
  })

  it('COMPANY_ECOMMERCE_QUESTIONS has exactly 3 questions, matching the other company-track sets\' length', () => {
    expect(COMPANY_ECOMMERCE_QUESTIONS).toHaveLength(3)
  })

  it('every COMPANY_ECOMMERCE_QUESTIONS entry has a non-empty id, text, and a suggestions array', () => {
    for (const q of COMPANY_ECOMMERCE_QUESTIONS) {
      expect(q.id).toBeTruthy()
      expect(q.text).toBeTruthy()
      expect(Array.isArray(q.suggestions)).toBe(true)
    }
  })
})
