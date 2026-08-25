/**
 * Unit tests for lib/build/help-faq.ts (#60) — the Help Center FAQ knowledge
 * base + retrieval logic that grounds the AI "ask anything" box.
 *
 * Covers every exported function and branch:
 *   - FAQ_ENTRIES integrity (ids unique, categories valid, non-empty Q/A)
 *   - tokenize (stopwords, punctuation, 1-char drop, empty)
 *   - scoreEntry (overlap, zero for no overlap, zero for empty query)
 *   - retrieveFaq (ranking, top-K limit, empty input, no-overlap fallback)
 *   - buildGroundingContext (formatting, empty input)
 *   - faqPageJsonLd (FAQPage shape, mirrors entries)
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest'
import {
  FAQ_ENTRIES,
  tokenize,
  scoreEntry,
  retrieveFaq,
  buildGroundingContext,
  faqPageJsonLd,
  type FaqEntry,
} from '@/lib/build/help-faq'

const VALID_CATEGORIES = [
  'getting-started',
  'building',
  'deploying',
  'billing',
  'ownership',
  'ai',
]

// ---------------------------------------------------------------------------
// FAQ_ENTRIES integrity
// ---------------------------------------------------------------------------

describe('FAQ_ENTRIES', () => {
  it('has a non-trivial number of curated entries', () => {
    expect(FAQ_ENTRIES.length).toBeGreaterThanOrEqual(8)
  })

  it('has unique ids', () => {
    const ids = FAQ_ENTRIES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every entry has a non-empty question, answer, and valid category', () => {
    for (const e of FAQ_ENTRIES) {
      expect(e.question.trim().length).toBeGreaterThan(0)
      expect(e.answer.trim().length).toBeGreaterThan(20)
      expect(VALID_CATEGORIES).toContain(e.category)
    }
  })

  it('uses kebab-case ids', () => {
    for (const e of FAQ_ENTRIES) {
      expect(e.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })
})

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

describe('tokenize', () => {
  it('lowercases, strips punctuation, and splits on whitespace', () => {
    expect(tokenize('Deploy My App!')).toEqual(['deploy', 'app'])
  })

  it('drops stopwords and single-character tokens', () => {
    // "how do i" are stopwords; "a" is a stopword; "x" is 1-char.
    expect(tokenize('how do i a x deploy')).toEqual(['deploy'])
  })

  it('returns [] for empty / non-string input', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('   ')).toEqual([])
    // @ts-expect-error — defensive: undefined coerces to ''
    expect(tokenize(undefined)).toEqual([])
  })

  it('collapses repeated whitespace and punctuation runs', () => {
    expect(tokenize('cost,,,  pricing')).toEqual(['cost', 'pricing'])
  })
})

// ---------------------------------------------------------------------------
// scoreEntry
// ---------------------------------------------------------------------------

describe('scoreEntry', () => {
  const deploy = FAQ_ENTRIES.find((e) => e.id === 'how-do-i-deploy') as FaqEntry

  it('scores by keyword overlap against question + answer + keywords', () => {
    expect(scoreEntry(['deploy'], deploy)).toBeGreaterThan(0)
  })

  it('returns 0 when nothing overlaps', () => {
    expect(scoreEntry(['zzzzq', 'wwwwq'], deploy)).toBe(0)
  })

  it('returns 0 for an empty query', () => {
    expect(scoreEntry([], deploy)).toBe(0)
  })

  it('matches synonyms declared in keywords (e.g. hosting → deploy entry)', () => {
    expect(scoreEntry(['hosting'], deploy)).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// retrieveFaq
// ---------------------------------------------------------------------------

describe('retrieveFaq', () => {
  it('returns [] for empty / stopword-only input', () => {
    expect(retrieveFaq('')).toEqual([])
    expect(retrieveFaq('how do i')).toEqual([])
  })

  it('ranks the most relevant entry first', () => {
    const hits = retrieveFaq('how do I deploy my app to a live url')
    expect(hits[0].id).toBe('how-do-i-deploy')
  })

  it('respects the top-K limit', () => {
    const hits = retrieveFaq('build deploy own cost ai agent domain', 3)
    expect(hits.length).toBeLessThanOrEqual(3)
  })

  it('finds ownership questions via keywords', () => {
    const hits = retrieveFaq('do I own the code, is there lock-in?')
    expect(hits.map((h) => h.id)).toContain('do-i-own-the-code')
  })

  it('falls back to foundational entries when there is no lexical overlap', () => {
    const hits = retrieveFaq('qwerty zxcvb asdfg', 4)
    expect(hits.length).toBe(4)
    // Fallback = first N entries, preserving order.
    expect(hits[0].id).toBe(FAQ_ENTRIES[0].id)
  })

  it('never returns more than the number of entries', () => {
    const hits = retrieveFaq('build deploy own cost ai agent domain plan docs', 100)
    expect(hits.length).toBeLessThanOrEqual(FAQ_ENTRIES.length)
  })
})

// ---------------------------------------------------------------------------
// buildGroundingContext
// ---------------------------------------------------------------------------

describe('buildGroundingContext', () => {
  it('returns an empty string for no entries', () => {
    expect(buildGroundingContext([])).toBe('')
    // @ts-expect-error — defensive null
    expect(buildGroundingContext(null)).toBe('')
  })

  it('formats each entry as a numbered Q/A block', () => {
    const ctx = buildGroundingContext(FAQ_ENTRIES.slice(0, 2))
    expect(ctx).toContain('[FAQ 1]')
    expect(ctx).toContain('[FAQ 2]')
    expect(ctx).toContain(FAQ_ENTRIES[0].question)
    expect(ctx).toContain(FAQ_ENTRIES[0].answer)
  })
})

// ---------------------------------------------------------------------------
// faqPageJsonLd
// ---------------------------------------------------------------------------

describe('faqPageJsonLd', () => {
  it('produces a valid FAQPage with one Question per entry', () => {
    const ld = faqPageJsonLd()
    expect(ld['@context']).toBe('https://schema.org')
    expect(ld['@type']).toBe('FAQPage')
    expect(ld.mainEntity.length).toBe(FAQ_ENTRIES.length)
  })

  it('each Question has an acceptedAnswer with matching text', () => {
    const ld = faqPageJsonLd(FAQ_ENTRIES.slice(0, 1))
    const q = ld.mainEntity[0]
    expect(q['@type']).toBe('Question')
    expect(q.name).toBe(FAQ_ENTRIES[0].question)
    expect(q.acceptedAnswer['@type']).toBe('Answer')
    expect(q.acceptedAnswer.text).toBe(FAQ_ENTRIES[0].answer)
  })

  it('accepts a custom subset of entries', () => {
    const subset = FAQ_ENTRIES.slice(0, 3)
    expect(faqPageJsonLd(subset).mainEntity.length).toBe(3)
  })
})
