import { describe, it, expect } from 'vitest'
import {
  buildDeckModel,
  extractBullets,
  keyFindings,
  execSummaryLine,
  normalizeDeckColor,
  deckToText,
  DECK_SECTIONS,
  VC_SECTIONS,
  SECTION_HEADINGS,
  DEFAULT_DECK_COLOR,
  type DeckArtifacts,
  type DeckBrand,
} from '@/lib/build/deck-model'

/**
 * #69 — pitch-deck composition model. This is the PURE, I/O-free core that turns a
 * company's artifacts (thesis/mission/roadmap/market/research) + brand into a
 * standard-VC slide model (problem → solution → market → product → traction → ask),
 * plus a cover. Fully unit-testable without a network or a model call. File
 * generation (PPTX) is mocked/separate — here we test the structured slide model.
 */

const BRAND: DeckBrand = { name: 'ShelfMind', tagline: 'Autonomous inventory for SMB retail', color: '#1e90ff' }

const THESIS = `## Executive Summary
SMB retailers lose margin to stockouts and manual reordering.

## Key Findings
- Small retailers manually reorder, wasting 8+ hours a week.
- Stockouts cost the average shop 4% of revenue.
- No affordable tool does autonomous purchase orders.

## Sources
- https://example.com/retail-report`

const MARKET = `## Executive Summary
The SMB retail-ops market is large and underserved.

## Key Findings
- 1.2M target SMB retailers in North America.
- $6B annual spend on inventory tooling.
- Demand signal: 40% growth in retail-automation searches.

## Sources
- https://example.com/market`

const ROADMAP = `## Key Findings
- Now: autonomous reorder suggestions.
- Next: one-click purchase orders to suppliers.
- Later: demand forecasting.`

describe('normalizeDeckColor', () => {
  it('accepts a valid #RRGGBB and uppercases it', () => {
    expect(normalizeDeckColor('#1e90ff')).toBe('#1E90FF')
  })
  it('falls back to the default for invalid / missing color', () => {
    expect(normalizeDeckColor('nope')).toBe(DEFAULT_DECK_COLOR)
    expect(normalizeDeckColor('#fff')).toBe(DEFAULT_DECK_COLOR)
    expect(normalizeDeckColor(undefined)).toBe(DEFAULT_DECK_COLOR)
    expect(normalizeDeckColor('')).toBe(DEFAULT_DECK_COLOR)
  })
})

describe('extractBullets', () => {
  it('returns [] for empty/whitespace input', () => {
    expect(extractBullets('')).toEqual([])
    expect(extractBullets('   \n  ')).toEqual([])
    expect(extractBullets(undefined)).toEqual([])
  })
  it('extracts markdown list items and strips inline markdown', () => {
    const b = extractBullets('- **Bold** point\n- a `code` bit\n- [link](http://x)')
    expect(b).toEqual(['Bold point', 'a code bit', 'link'])
  })
  it('supports *, +, and numbered list markers', () => {
    expect(extractBullets('* one\n+ two\n1. three\n2) four')).toEqual(['one', 'two', 'three', 'four'])
  })
  it('caps at max and de-duplicates', () => {
    const b = extractBullets('- alpha\n- alpha\n- beta\n- gamma\n- delta\n- epsilon', 3)
    expect(b).toEqual(['alpha', 'beta', 'gamma'])
  })
  it('drops list items whose content is too short to be a real point', () => {
    // Single-char items are noise, not findings → filtered by the min-length guard.
    expect(extractBullets('- a\n- bb\n- real point here')).toEqual(['real point here'])
  })
  it('falls back to sentences from prose when there are no list items', () => {
    const b = extractBullets('First fact here. Second fact follows! Third one?', 2)
    expect(b.length).toBe(2)
    expect(b[0]).toContain('First fact')
  })
  it('ignores headings, code fences and table rows in the prose fallback', () => {
    const b = extractBullets('# Heading\n```\ncode\n```\n| a | b |\nReal sentence here.')
    expect(b).toEqual(['Real sentence here.'])
  })
})

describe('keyFindings', () => {
  it('pulls the Key Findings section body out of a structured doc', () => {
    const kf = keyFindings(THESIS)
    expect(kf).toContain('manually reorder')
    expect(kf).not.toContain('Executive Summary')
    expect(kf).not.toContain('Sources')
  })
  it('falls back to the whole doc when no Key Findings section exists', () => {
    expect(keyFindings('just some prose')).toBe('just some prose')
  })
  it('returns "" for empty', () => {
    expect(keyFindings('')).toBe('')
    expect(keyFindings(undefined)).toBe('')
  })
})

describe('execSummaryLine', () => {
  it('pulls the first Executive Summary line as a framing sub-heading', () => {
    expect(execSummaryLine(THESIS)).toContain('SMB retailers lose margin')
  })
  it('returns "" when there is no Executive Summary', () => {
    expect(execSummaryLine(ROADMAP)).toBe('')
    expect(execSummaryLine('')).toBe('')
  })
})

describe('buildDeckModel', () => {
  const artifacts: DeckArtifacts = { thesis: THESIS, mission: THESIS, market: MARKET, roadmap: ROADMAP }
  const model = buildDeckModel(artifacts, BRAND, { generatedAt: '2026-08-25T00:00:00Z' })

  it('produces a cover slide + one slide per VC section in order', () => {
    expect(model.slides.map((s) => s.section)).toEqual([...DECK_SECTIONS])
    // First slide is the cover branded with the company name + tagline.
    expect(model.slides[0].section).toBe('title')
    expect(model.slides[0].heading).toBe('ShelfMind')
    expect(model.slides[0].subheading).toBe('Autonomous inventory for SMB retail')
    expect(model.slides[0].bullets).toEqual([])
  })

  it('covers the standard VC structure: problem, solution, market, product, traction, ask', () => {
    const contentSections = model.slides.filter((s) => s.section !== 'title').map((s) => s.section)
    expect(contentSections).toEqual([...VC_SECTIONS])
  })

  it('derives each section body from the mapped artifact (never lorem)', () => {
    const problem = model.slides.find((s) => s.section === 'problem')!
    expect(problem.placeholder).toBe(false)
    expect(problem.bullets.join(' ')).toContain('manually reorder')
    const market = model.slides.find((s) => s.section === 'market')!
    expect(market.bullets.join(' ')).toContain('1.2M target SMB retailers')
    const product = model.slides.find((s) => s.section === 'product')!
    expect(product.bullets.join(' ')).toContain('autonomous reorder')
  })

  it('applies the section headings', () => {
    for (const sec of VC_SECTIONS) {
      const slide = model.slides.find((s) => s.section === sec)!
      expect(slide.heading).toBe(SECTION_HEADINGS[sec])
    }
  })

  it('normalizes the brand color and clamps long names/taglines', () => {
    const m = buildDeckModel({}, { name: 'x'.repeat(200), tagline: 'y'.repeat(300), color: 'bad' })
    expect(m.brand.color).toBe(DEFAULT_DECK_COLOR)
    expect(m.brand.name.length).toBe(120)
    expect((m.brand.tagline || '').length).toBe(200)
  })

  it('marks a section with no backing artifact as an honest placeholder', () => {
    const m = buildDeckModel({ thesis: THESIS }, BRAND) // no market/roadmap/research
    const market = m.slides.find((s) => s.section === 'market')!
    expect(market.placeholder).toBe(true)
    expect(market.bullets.length).toBe(1)
    expect(market.bullets[0].toLowerCase()).toContain('market research')
    // ask has no artifact and no override → placeholder.
    const ask = m.slides.find((s) => s.section === 'ask')!
    expect(ask.placeholder).toBe(true)
  })

  it('honors caller-provided ask + traction overrides (filled, not placeholder)', () => {
    const m = buildDeckModel({}, BRAND, {
      ask: ['Raising $1.5M seed', 'Use of funds: eng + GTM'],
      traction: ['3 design partners', '$12k MRR'],
    })
    const ask = m.slides.find((s) => s.section === 'ask')!
    expect(ask.placeholder).toBe(false)
    expect(ask.bullets).toContain('Raising $1.5M seed')
    const traction = m.slides.find((s) => s.section === 'traction')!
    expect(traction.placeholder).toBe(false)
    expect(traction.bullets).toContain('3 design partners')
  })

  it('uses the idea as the cover subtitle when no tagline is set', () => {
    const m = buildDeckModel({ idea: 'AI copilot for retail' }, { name: 'NoTagline Co' })
    expect(m.slides[0].subheading).toBe('AI copilot for retail')
  })

  it('reports filled vs total content sections', () => {
    // thesis(→problem+solution) + market + roadmap(→product) = 4 filled; traction+ask placeholder.
    expect(model.totalSections).toBe(6)
    expect(model.filledSections).toBe(4)
  })

  it('defaults company name and generatedAt when absent', () => {
    const m = buildDeckModel({}, { name: '' })
    expect(m.slides[0].heading).toBe('Your Company')
    expect(typeof m.generatedAt).toBe('string')
    expect(m.generatedAt.length).toBeGreaterThan(0)
  })
})

describe('deckToText', () => {
  it('renders a deterministic plain-text deck with every slide + bullets', () => {
    const model = buildDeckModel({ thesis: THESIS, market: MARKET }, BRAND, { generatedAt: 'x' })
    const txt = deckToText(model)
    expect(txt).toContain('ShelfMind')
    expect(txt).toContain('Problem')
    expect(txt).toContain('Market')
    expect(txt).toContain('The Ask')
    expect(txt).toContain('•')
    // Placeholder sections are flagged, not faked.
    expect(txt).toContain('placeholder')
  })
})
