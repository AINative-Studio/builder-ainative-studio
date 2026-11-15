import { describe, it, expect } from 'vitest'
import { fallbackNameFromIdea } from '@/lib/build/idea-fallback-name'

/**
 * #2067: the company-naming fallback used to collapse to just a leading
 * bracketed/tagged prefix (e.g. "[LOOP-TEST 2026-11-15] A simple cafe
 * feedback board…" → "[LOOP-TEST", missing the closing bracket and the
 * entire real idea) because it took idea.split(/\s+/)[0] without first
 * stripping the tag.
 */
describe('fallbackNameFromIdea (#2067)', () => {
  it('strips a leading bracketed tag before taking the first word', () => {
    const idea = '[LOOP-TEST 2026-11-15] A simple customer feedback board for a small cafe'
    expect(fallbackNameFromIdea(idea)).not.toContain('[')
    expect(fallbackNameFromIdea(idea)).not.toBe('[LOOP-TEST')
  })

  it('strips a leading parenthetical tag the same way', () => {
    const idea = '(JIRA-123) A home rental marketplace'
    expect(fallbackNameFromIdea(idea)).not.toContain('(')
    expect(fallbackNameFromIdea(idea)).toBe('Home')
  })

  it('still strips the "build" preamble for a plain idea (pre-existing behavior, unchanged)', () => {
    expect(fallbackNameFromIdea('build scheduling tool')).toBe('Scheduling')
  })

  it('falls back to the given default word when nothing meaningful is left', () => {
    expect(fallbackNameFromIdea('', 'Cody')).toBe('Cody')
    expect(fallbackNameFromIdea('   ', 'app')).toBe('App')
  })

  it('strips stray punctuation left on the chosen word', () => {
    expect(fallbackNameFromIdea('"quoted" idea about gardening')).toBe('Quoted')
  })
})
