import { describe, it, expect } from 'vitest'
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_TAGS,
  COMPLEXITY_LEVELS,
  SORT_OPTIONS,
} from '@/lib/types/template'

/**
 * Issue #1201 — Coverage Phase 1 follow-up.
 *
 * lib/types/template.ts is almost entirely type declarations, but it also
 * exports four constant catalogs (categories, tags, complexity levels, sort
 * options) consumed by the templates gallery UI. Nothing previously imported
 * this module in a test, so the constants showed 0% coverage. These are data
 * contracts other code relies on (e.g. an 'all' category value, specific
 * sort keys) so we assert their real shape rather than just importing them.
 */
describe('#1201 lib/types/template constants', () => {
  it('TEMPLATE_CATEGORIES includes an "all" option plus the known category values', () => {
    const values = TEMPLATE_CATEGORIES.map((c) => c.value)
    expect(values).toContain('all')
    expect(values).toEqual(['all', 'dashboard', 'ecommerce', 'landing', 'admin', 'blog'])
    for (const category of TEMPLATE_CATEGORIES) {
      expect(typeof category.value).toBe('string')
      expect(typeof category.label).toBe('string')
      expect(category.label.length).toBeGreaterThan(0)
    }
  })

  it('TEMPLATE_TAGS is a non-empty list of unique, non-empty strings', () => {
    expect(TEMPLATE_TAGS.length).toBeGreaterThan(0)
    expect(new Set(TEMPLATE_TAGS).size).toBe(TEMPLATE_TAGS.length)
    for (const tag of TEMPLATE_TAGS) {
      expect(typeof tag).toBe('string')
      expect(tag.length).toBeGreaterThan(0)
    }
  })

  it('COMPLEXITY_LEVELS covers exactly simple/medium/advanced', () => {
    const values = COMPLEXITY_LEVELS.map((c) => c.value)
    expect(values).toEqual(['simple', 'medium', 'advanced'])
  })

  it('SORT_OPTIONS covers exactly most-used/newest/a-z', () => {
    const values = SORT_OPTIONS.map((s) => s.value)
    expect(values).toEqual(['most-used', 'newest', 'a-z'])
  })
})
