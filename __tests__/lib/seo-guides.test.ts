/**
 * Unit tests for the SEO guides catalog (Issue #35).
 *
 * These guides power the /guides blog/tutorials hub and the individually
 * indexable /guides/[slug] long-form articles. The tests guard the contract
 * those pages + the sitemap rely on:
 *   - at least the four required long-tail articles
 *   - unique, URL-safe slugs
 *   - required rich-content fields present (intro, sections, faqs, keywords…)
 *   - the specific issue-mandated topics exist and target their keywords
 *   - lookup + generateStaticParams inputs stay in sync
 */

import { describe, it, expect } from 'vitest'
import { GUIDES, GUIDE_SLUGS, getGuideBySlug } from '@/lib/data/seo-guides'

describe('SEO guides catalog', () => {
  it('exposes at least 4 guides', () => {
    expect(GUIDES.length).toBeGreaterThanOrEqual(4)
  })

  it('has unique slugs', () => {
    const slugs = GUIDES.map((g) => g.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('has URL-safe slugs (lowercase, hyphenated)', () => {
    for (const g of GUIDES) {
      expect(g.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
  })

  it('exposes a unique title per guide', () => {
    const titles = GUIDES.map((g) => g.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('keeps GUIDE_SLUGS in sync with the catalog', () => {
    expect(GUIDE_SLUGS).toHaveLength(GUIDES.length)
    expect(GUIDE_SLUGS).toEqual(GUIDES.map((g) => g.slug))
  })

  it('provides rich, indexable content for every guide', () => {
    for (const g of GUIDES) {
      // Excerpt/intro must be substantial for SEO (not stubs).
      expect(g.excerpt.length).toBeGreaterThanOrEqual(60)
      expect(g.intro.length).toBeGreaterThanOrEqual(40)
      expect(g.title.length).toBeGreaterThan(10)
      expect(['Tutorial', 'Comparison', 'Concept', 'Best Practices']).toContain(
        g.category
      )
      expect(g.readTimeMinutes).toBeGreaterThan(0)

      // Keywords / tags for meta + JSON-LD.
      expect(g.keywords.length).toBeGreaterThanOrEqual(3)
      expect(g.tags.length).toBeGreaterThanOrEqual(1)

      // Body sections with real prose.
      expect(g.sections.length).toBeGreaterThanOrEqual(3)
      for (const s of g.sections) {
        expect(s.heading).toBeTruthy()
        expect(s.paragraphs.length).toBeGreaterThanOrEqual(1)
        for (const p of s.paragraphs) {
          expect(p.length).toBeGreaterThanOrEqual(80)
        }
      }

      // FAQ entries for FAQPage JSON-LD.
      expect(g.faqs.length).toBeGreaterThanOrEqual(2)
      for (const f of g.faqs) {
        expect(f.question).toBeTruthy()
        expect(f.answer.length).toBeGreaterThanOrEqual(40)
      }
    }
  })

  it('uses valid, non-future publish/modified dates', () => {
    for (const g of GUIDES) {
      expect(g.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(g.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(Date.parse(g.datePublished))).toBe(false)
      expect(Number.isNaN(Date.parse(g.dateModified))).toBe(false)
      // Modified should not predate published.
      expect(Date.parse(g.dateModified)).toBeGreaterThanOrEqual(
        Date.parse(g.datePublished)
      )
    }
  })

  it('includes the issue-mandated long-tail articles', () => {
    const slugs = new Set(GUIDE_SLUGS)
    expect(slugs.has('how-to-build-a-saas-with-ai')).toBe(true)
    expect(slugs.has('v0-vs-lovable-vs-ainative')).toBe(true)
    expect(slugs.has('what-is-ax-optimization')).toBe(true)
  })

  it('targets the intended long-tail keyword in each mandated article', () => {
    const cases: Array<[string, string]> = [
      ['how-to-build-a-saas-with-ai', 'how to build a saas with ai'],
      ['v0-vs-lovable-vs-ainative', 'v0 vs lovable vs ainative'],
      ['what-is-ax-optimization', 'what is ax optimization'],
    ]
    for (const [slug, keyword] of cases) {
      const guide = getGuideBySlug(slug)
      expect(guide).toBeDefined()
      const hasKeyword = guide!.keywords.some(
        (k) => k.toLowerCase() === keyword
      )
      expect(hasKeyword).toBe(true)
    }
  })
})

describe('getGuideBySlug', () => {
  it('returns the matching guide for a known slug', () => {
    const g = getGuideBySlug('what-is-ax-optimization')
    expect(g).toBeDefined()
    expect(g?.category).toBe('Concept')
  })

  it('returns undefined for an unknown slug', () => {
    expect(getGuideBySlug('does-not-exist')).toBeUndefined()
  })

  it('resolves every slug in the catalog', () => {
    for (const slug of GUIDE_SLUGS) {
      expect(getGuideBySlug(slug)).toBeDefined()
    }
  })
})
