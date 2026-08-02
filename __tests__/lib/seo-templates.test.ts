/**
 * Unit tests for the SEO template catalog (Issue #34).
 *
 * These templates power the individually indexable /templates/[slug] landing
 * pages. The tests guard the contract those pages + the sitemap rely on:
 *   - exactly 12 templates
 *   - unique, URL-safe slugs
 *   - required rich-content fields present (description, keywords, features…)
 *   - lookup + generateStaticParams inputs stay in sync
 */

import { describe, it, expect } from 'vitest'
import {
  SEO_TEMPLATES,
  TEMPLATE_SLUGS,
  getSeoTemplateBySlug,
} from '@/lib/data/seo-templates'

describe('SEO template catalog', () => {
  it('exposes exactly 12 templates', () => {
    expect(SEO_TEMPLATES).toHaveLength(12)
  })

  it('has unique slugs', () => {
    const slugs = SEO_TEMPLATES.map((t) => t.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('has URL-safe slugs (lowercase, hyphenated)', () => {
    for (const t of SEO_TEMPLATES) {
      expect(t.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
  })

  it('exposes a unique name per template', () => {
    const names = SEO_TEMPLATES.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps TEMPLATE_SLUGS in sync with the catalog', () => {
    expect(TEMPLATE_SLUGS).toHaveLength(SEO_TEMPLATES.length)
    expect(TEMPLATE_SLUGS).toEqual(SEO_TEMPLATES.map((t) => t.slug))
  })

  it('provides rich, indexable content for every template', () => {
    for (const t of SEO_TEMPLATES) {
      // Descriptions must be substantial for SEO (not stubs).
      expect(t.description.length).toBeGreaterThanOrEqual(120)
      expect(t.tagline.length).toBeGreaterThan(10)
      expect(t.category).toBeTruthy()
      expect(['simple', 'medium', 'advanced']).toContain(t.complexity)

      // Keywords / tags for meta + JSON-LD.
      expect(t.keywords.length).toBeGreaterThanOrEqual(3)
      expect(t.tags.length).toBeGreaterThanOrEqual(1)

      // Rich page sections.
      expect(t.features.length).toBeGreaterThanOrEqual(2)
      for (const f of t.features) {
        expect(f.title).toBeTruthy()
        expect(f.description).toBeTruthy()
      }
      expect(t.useCases.length).toBeGreaterThanOrEqual(2)
      expect(t.componentsUsed.length).toBeGreaterThanOrEqual(1)

      // A code preview + a generator prompt.
      expect(t.codePreview.trim().length).toBeGreaterThan(20)
      expect(t.prompt.length).toBeGreaterThan(10)
    }
  })

  it('targets "AI <category> template" search intent in keywords', () => {
    for (const t of SEO_TEMPLATES) {
      const hasCategoryKeyword = t.keywords.some((k) =>
        k.toLowerCase().includes(t.category.toLowerCase())
      )
      expect(hasCategoryKeyword).toBe(true)
    }
  })
})

describe('getSeoTemplateBySlug', () => {
  it('returns the matching template for a known slug', () => {
    const t = getSeoTemplateBySlug('analytics-dashboard')
    expect(t).toBeDefined()
    expect(t?.name).toBe('Analytics Dashboard')
  })

  it('returns undefined for an unknown slug', () => {
    expect(getSeoTemplateBySlug('does-not-exist')).toBeUndefined()
  })

  it('resolves every slug in the catalog', () => {
    for (const slug of TEMPLATE_SLUGS) {
      expect(getSeoTemplateBySlug(slug)).toBeDefined()
    }
  })
})
