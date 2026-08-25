import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { deckToPptx, deckFileName, xmlEscape, slideXml } from '@/lib/build/deck-pptx'
import { buildDeckModel } from '@/lib/build/deck-model'

/**
 * #69 — PPTX serialization seam. deck-model.ts is the tested composition core;
 * this verifies the DeckModel → valid .pptx (OOXML zip) serialization produces a
 * well-formed package with the required parts, one slide per model slide, themed
 * with the brand color — using jszip (no new dependency).
 */

const THESIS =
  '## Key Findings\n- Retailers reorder manually.\n- Stockouts cost revenue.'

describe('xmlEscape', () => {
  it('escapes XML-special characters', () => {
    expect(xmlEscape('a & b < c > d "e" \'f\'')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;')
  })
})

describe('deckFileName', () => {
  it('slugs the company name and appends the extension', () => {
    expect(deckFileName('Acme Corp!')).toBe('acme-corp-pitch-deck.pptx')
    expect(deckFileName('Acme Corp', 'txt')).toBe('acme-corp-pitch-deck.txt')
  })
  it('falls back to "company" for an empty/symbol-only name', () => {
    expect(deckFileName('')).toBe('company-pitch-deck.pptx')
    expect(deckFileName('!!!')).toBe('company-pitch-deck.pptx')
  })
})

describe('slideXml', () => {
  it('renders a cover slide with the brand band + name', () => {
    const model = buildDeckModel({}, { name: 'ShelfMind', tagline: 'tag', color: '#1E90FF' })
    const xml = slideXml(model.slides[0], '#1E90FF')
    expect(xml).toContain('<p:sld')
    expect(xml).toContain('ShelfMind')
    expect(xml).toContain('1E90FF') // brand band fill
  })
  it('renders a content slide with heading + escaped bullets', () => {
    const model = buildDeckModel({ thesis: '## Key Findings\n- A & B danger' }, { name: 'X' })
    const problem = model.slides.find((s) => s.section === 'problem')!
    const xml = slideXml(problem, '#000000')
    expect(xml).toContain('Problem')
    expect(xml).toContain('A &amp; B danger')
  })
})

describe('deckToPptx', () => {
  it('produces a valid .pptx zip with the required OOXML parts', async () => {
    const model = buildDeckModel({ thesis: THESIS, market: '## Key Findings\n- $6B market' }, {
      name: 'ShelfMind',
      tagline: 'Autonomous inventory',
      color: '#1E90FF',
    })
    const bytes = await deckToPptx(model)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(500)

    // Re-open the zip and assert the package structure.
    const zip = await JSZip.loadAsync(bytes)
    expect(zip.file('[Content_Types].xml')).toBeTruthy()
    expect(zip.file('_rels/.rels')).toBeTruthy()
    expect(zip.file('ppt/presentation.xml')).toBeTruthy()
    expect(zip.file('ppt/_rels/presentation.xml.rels')).toBeTruthy()
    expect(zip.file('ppt/slideMasters/slideMaster1.xml')).toBeTruthy()
    expect(zip.file('ppt/slideLayouts/slideLayout1.xml')).toBeTruthy()
    expect(zip.file('ppt/theme/theme1.xml')).toBeTruthy()

    // One slide part per model slide (cover + 6 sections = 7).
    const slideFiles = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    expect(slideFiles.length).toBe(model.slides.length)
    expect(slideFiles.length).toBe(7)

    // The theme carries the brand accent, and the cover carries the company name.
    const theme = await zip.file('ppt/theme/theme1.xml')!.async('string')
    expect(theme).toContain('1E90FF')
    const slide1 = await zip.file('ppt/slides/slide1.xml')!.async('string')
    expect(slide1).toContain('ShelfMind')

    // Content types declares every slide override.
    const ct = await zip.file('[Content_Types].xml')!.async('string')
    expect((ct.match(/slides\/slide\d+\.xml/g) || []).length).toBe(7)
  })
})
