/**
 * Unit tests for lib/help/stuck-search.ts (#321, GR-12) — the "I'm stuck"
 * jump-to-answer search: anchor generation, tokenization, weighted scoring,
 * the full-catalog builder, the default keyword ranker, and the ranker seam.
 *
 * Covers:
 *   - slugifyAnchor (lowercase, punctuation, apostrophes, empty fallback)
 *   - sectionAnchors (dedup suffixes, prefixing, stability)
 *   - toSnippet (truncation on word boundary, whitespace collapse)
 *   - tokenize (stopwords, punctuation, 1-char drop, empty)
 *   - scoreSection (title > keyword > body weighting, zero cases)
 *   - buildStuckCatalog / getStuckCatalog (full corpus, unique hrefs,
 *     anchors match the slugified headings the guide page renders)
 *   - keywordRanker + searchStuck (ranking, limit, empty input, no fake
 *     matches, deterministic order, custom-ranker seam)
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest'
import {
  slugifyAnchor,
  sectionAnchors,
  toSnippet,
  tokenize,
  scoreSection,
  buildStuckCatalog,
  getStuckCatalog,
  keywordRanker,
  searchStuck,
  DEFAULT_RESULT_LIMIT,
  type StuckSection,
  type StuckRanker,
} from '@/lib/help/stuck-search'
import { GUIDES } from '@/lib/data/seo-guides'
import { FAQ_ENTRIES } from '@/lib/build/help-faq'

function makeSection(overrides: Partial<StuckSection> = {}): StuckSection {
  return {
    id: 'guides/test#anchor',
    source: 'guide',
    title: 'Deploy your app',
    parentTitle: 'Test guide',
    href: '/guides/test#anchor',
    snippet: 'How to deploy.',
    body: 'Point a custom domain at the subdomain and ship.',
    keywords: ['hosting', 'railway'],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// slugifyAnchor
// ---------------------------------------------------------------------------

describe('slugifyAnchor', () => {
  it('lowercases and hyphenates words', () => {
    expect(slugifyAnchor('Add a database and real data')).toBe(
      'add-a-database-and-real-data',
    )
  })

  it('strips punctuation and collapses separators', () => {
    expect(slugifyAnchor('SEO — and (structured) data!')).toBe(
      'seo-and-structured-data',
    )
  })

  it('removes apostrophes instead of splitting the word', () => {
    expect(slugifyAnchor("What's the user's plan?")).toBe('whats-the-users-plan')
  })

  it('trims leading/trailing hyphens', () => {
    expect(slugifyAnchor('  …Deploy!  ')).toBe('deploy')
  })

  it('falls back to "section" for empty or symbol-only input', () => {
    expect(slugifyAnchor('')).toBe('section')
    expect(slugifyAnchor('***')).toBe('section')
  })
})

// ---------------------------------------------------------------------------
// sectionAnchors
// ---------------------------------------------------------------------------

describe('sectionAnchors', () => {
  it('generates one anchor per heading', () => {
    expect(sectionAnchors(['First step', 'Second step'])).toEqual([
      'first-step',
      'second-step',
    ])
  })

  it('de-duplicates repeated headings with numeric suffixes', () => {
    expect(sectionAnchors(['Setup', 'Setup', 'Setup'])).toEqual([
      'setup',
      'setup-2',
      'setup-3',
    ])
  })

  it('namespaces with a prefix', () => {
    expect(sectionAnchors(['How much does it cost?'], 'faq')).toEqual([
      'faq-how-much-does-it-cost',
    ])
  })

  it('is stable — same input always yields the same anchors', () => {
    const headings = GUIDES[0].sections.map((s) => s.heading)
    expect(sectionAnchors(headings)).toEqual(sectionAnchors(headings))
  })

  it('returns [] for an empty list', () => {
    expect(sectionAnchors([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// toSnippet
// ---------------------------------------------------------------------------

describe('toSnippet', () => {
  it('returns short text unchanged', () => {
    expect(toSnippet('Short and sweet.')).toBe('Short and sweet.')
  })

  it('collapses internal whitespace', () => {
    expect(toSnippet('a  b\n\tc')).toBe('a b c')
  })

  it('truncates long text on a word boundary with an ellipsis', () => {
    const long = 'word '.repeat(100).trim()
    const snip = toSnippet(long, 50)
    expect(snip.length).toBeLessThanOrEqual(51)
    expect(snip.endsWith('…')).toBe(true)
    expect(snip).not.toMatch(/wor…$/) // no mid-word cut
  })

  it('hard-cuts when there is no space before the limit', () => {
    const snip = toSnippet('x'.repeat(200), 50)
    expect(snip).toBe('x'.repeat(50) + '…')
  })

  it('handles empty input', () => {
    expect(toSnippet('')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumerics', () => {
    expect(tokenize('Deploy MY-App!')).toEqual(['deploy', 'app'])
  })

  it('drops stopwords and 1-character tokens', () => {
    expect(tokenize('I am stuck on the deploy of a x')).toEqual(['deploy'])
  })

  it('removes apostrophes without splitting words', () => {
    expect(tokenize("can't domain")).toEqual(['domain'])
  })

  it('returns [] for empty and stopword-only input', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('how do i')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// scoreSection
// ---------------------------------------------------------------------------

describe('scoreSection', () => {
  it('weights title matches (3) over keyword (2) over body (1)', () => {
    const section = makeSection()
    expect(scoreSection(['deploy'], section)).toBe(3) // title hit
    expect(scoreSection(['railway'], section)).toBe(2) // keyword hit
    expect(scoreSection(['domain'], section)).toBe(1) // body hit
    expect(scoreSection(['deploy', 'railway', 'domain'], section)).toBe(6)
  })

  it('counts each distinct query token once at its highest weight', () => {
    const section = makeSection({ title: 'Deploy', body: 'deploy deploy deploy' })
    expect(scoreSection(['deploy', 'deploy'], section)).toBe(3)
  })

  it('returns 0 for no overlap and for an empty query', () => {
    const section = makeSection()
    expect(scoreSection(['zebra'], section)).toBe(0)
    expect(scoreSection([], section)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// buildStuckCatalog / getStuckCatalog
// ---------------------------------------------------------------------------

describe('buildStuckCatalog', () => {
  const catalog = buildStuckCatalog()

  it('indexes every guide section, every guide FAQ, and every help FAQ', () => {
    const expected =
      GUIDES.reduce((n, g) => n + g.sections.length + g.faqs.length, 0) +
      FAQ_ENTRIES.length
    expect(catalog.length).toBe(expected)
  })

  it('gives every entry a unique href', () => {
    const hrefs = catalog.map((s) => s.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('deep-links guide sections with the SAME anchors the page renders', () => {
    for (const guide of GUIDES) {
      const anchors = sectionAnchors(guide.sections.map((s) => s.heading))
      guide.sections.forEach((section, i) => {
        const entry = catalog.find(
          (s) => s.source === 'guide' && s.title === section.heading &&
            s.parentTitle === guide.title,
        )
        expect(entry?.href).toBe(`/guides/${guide.slug}#${anchors[i]}`)
      })
    }
  })

  it('deep-links guide FAQs with the faq- prefixed anchors the page renders', () => {
    const guide = GUIDES[0]
    const faqAnchors = sectionAnchors(guide.faqs.map((f) => f.question), 'faq')
    const entry = catalog.find(
      (s) => s.source === 'guide-faq' && s.title === guide.faqs[0].question,
    )
    expect(entry?.href).toBe(`/guides/${guide.slug}#${faqAnchors[0]}`)
  })

  it('deep-links help FAQ entries to /help#{id} (ids the page already renders)', () => {
    for (const faq of FAQ_ENTRIES) {
      const entry = catalog.find((s) => s.source === 'help-faq' && s.title === faq.question)
      expect(entry?.href).toBe(`/help#${faq.id}`)
    }
  })

  it('produces non-empty title, snippet, and body for every entry', () => {
    for (const entry of catalog) {
      expect(entry.title.length).toBeGreaterThan(0)
      expect(entry.snippet.length).toBeGreaterThan(0)
      expect(entry.body.length).toBeGreaterThan(0)
      expect(entry.parentTitle.length).toBeGreaterThan(0)
    }
  })

  it('does not fabricate video entries (no chapter data exists in the repo)', () => {
    expect(catalog.some((s) => s.source === 'video')).toBe(false)
  })

  it('getStuckCatalog caches and returns the same corpus', () => {
    const a = getStuckCatalog()
    const b = getStuckCatalog()
    expect(a).toBe(b) // same reference (cached)
    expect(a.length).toBe(catalog.length)
  })
})

// ---------------------------------------------------------------------------
// keywordRanker + searchStuck
// ---------------------------------------------------------------------------

describe('keywordRanker', () => {
  it('ranks stronger matches first and respects the limit', () => {
    const catalog = [
      makeSection({ href: '/a', title: 'Nothing relevant', body: 'unrelated', keywords: [] }),
      makeSection({ href: '/b', title: 'Custom domain setup', body: 'point dns', keywords: [] }),
      makeSection({ href: '/c', title: 'Other', body: 'mentions domain once', keywords: [] }),
    ]
    const results = keywordRanker('custom domain', catalog, 2)
    expect(results.map((r) => r.href)).toEqual(['/b', '/c'])
    expect(results[0].score).toBeGreaterThan(results[1].score)
  })

  it('breaks score ties by catalog order (deterministic)', () => {
    const catalog = [
      makeSection({ href: '/first', title: 'Deploy' }),
      makeSection({ href: '/second', title: 'Deploy' }),
    ]
    const results = keywordRanker('deploy', catalog, 5)
    expect(results.map((r) => r.href)).toEqual(['/first', '/second'])
  })

  it('returns [] for empty or stopword-only questions', () => {
    const catalog = [makeSection()]
    expect(keywordRanker('', catalog, 5)).toEqual([])
    expect(keywordRanker('how do i', catalog, 5)).toEqual([])
  })

  it('returns [] when nothing overlaps — never fakes a match', () => {
    expect(keywordRanker('zzzz qqqq', [makeSection()], 5)).toEqual([])
  })

  it('maps sections to result shape with href/title/parent/snippet/score', () => {
    const [r] = keywordRanker('deploy', [makeSection()], 1)
    expect(r).toEqual({
      href: '/guides/test#anchor',
      title: 'Deploy your app',
      parentTitle: 'Test guide',
      source: 'guide',
      snippet: 'How to deploy.',
      score: 3,
    })
  })
})

describe('searchStuck', () => {
  it('finds the deploy guide section for a deploy question', () => {
    const results = searchStuck('my app will not deploy to a live URL')
    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThanOrEqual(DEFAULT_RESULT_LIMIT)
    expect(results.some((r) => r.href.includes('deploy') || /deploy/i.test(r.title))).toBe(true)
  })

  it('searches the FULL catalog — help FAQ answers surface too', () => {
    const results = searchStuck('do I need an account to sign up')
    expect(results.some((r) => r.href.startsWith('/help#'))).toBe(true)
  })

  it('returns deep links with anchors for guide hits', () => {
    const results = searchStuck('structured data JSON-LD sitemap')
    const guideHit = results.find((r) => r.href.startsWith('/guides/'))
    expect(guideHit).toBeDefined()
    expect(guideHit!.href).toMatch(/^\/guides\/[a-z0-9-]+#[a-z0-9-]+$/)
  })

  it('returns [] for an unanswerable question instead of guessing', () => {
    expect(searchStuck('xylophone quantum zebra')).toEqual([])
  })

  it('accepts a custom ranker (ZeroDB embeddings seam)', () => {
    const custom: StuckRanker = (question, catalog, limit) =>
      catalog.slice(0, limit).map((s) => ({
        href: s.href,
        title: s.title,
        parentTitle: s.parentTitle,
        source: s.source,
        snippet: s.snippet,
        score: 1,
      }))
    const results = searchStuck('anything', 2, custom)
    expect(results.length).toBe(2)
    expect(results[0].score).toBe(1)
  })
})
