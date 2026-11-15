import { describe, it, expect } from 'vitest'
import { fallbackName } from '@/components/build/screens/Intake'

/**
 * Intake's client-side fallbackName() (issue #2067) — fires only when the
 * /api/build/brand fetch itself fails to return a usable name (network error,
 * non-JSON response), distinct from the server-side last-resort fallback in
 * app/api/build/brand/route.ts (covered separately in
 * __tests__/api/brand-name-uniqueness.test.ts). Both duplicate the same
 * "strip a leading bracketed tag, then take the first meaningful word" logic
 * and both needed the same fix.
 */
describe('Intake fallbackName (#2067)', () => {
  it('strips a leading bracketed tag before taking the first meaningful word', () => {
    expect(fallbackName('[LOOP-TEST 2026-11-15] A simple customer feedback board for a small cafe'))
      .toBe('Simple')
  })

  it('strips a leading parenthesized tag the same way', () => {
    expect(fallbackName('(internal test) A scheduling assistant for dentists')).toBe('Scheduling')
  })

  it('still strips the "I want to" preamble when there is no tag', () => {
    expect(fallbackName('I want to build a scheduling assistant')).toBe('A')
  })

  it('falls back to "Cody" when the idea is empty after stripping', () => {
    expect(fallbackName('[LOOP-TEST]')).toBe('Cody')
  })
})
