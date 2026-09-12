// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadCollapsedCategories,
  saveCollapsedCategories,
  hasExplicitOverrideThisRun,
  markExplicitOverrideThisRun,
  clearExplicitOverrideThisRun,
  isCategoryExpanded,
} from '@/lib/build/artifact-rail-prefs'

/**
 * #652 — Artifacts menu accordion. Default is collapsed-by-category (a large
 * finished project stays scannable); Cody actively driving the build
 * (state.auto) forces every category open instead, so new output never
 * lands inside a section the founder hasn't opened. A founder's own explicit
 * collapse mid-run is never overridden again for the rest of that run.
 */
describe('artifact-rail-prefs (#652)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  describe('isCategoryExpanded — the core decision', () => {
    it('forces expanded while Cody is actively driving, even if persisted as collapsed', () => {
      expect(isCategoryExpanded('Product', ['Product'], true, false)).toBe(true)
    })

    it('respects the persisted preference once idle (auto=false)', () => {
      expect(isCategoryExpanded('Product', ['Product'], false, false)).toBe(false)
      expect(isCategoryExpanded('Thesis', ['Product'], false, false)).toBe(true)
    })

    it('a category never in the collapsed list is expanded by default when idle', () => {
      expect(isCategoryExpanded('Thesis', [], false, false)).toBe(true)
    })

    it('an explicit override this run stops the force-open behavior, even mid-build', () => {
      // Founder collapsed "Operations" mid-run — auto is still true (Cody still
      // driving), but the override means we respect the persisted choice now.
      expect(isCategoryExpanded('Operations', ['Operations'], true, true)).toBe(false)
      // A category the founder did NOT touch stays expanded even after the override
      // flag flips true, since the override only means "stop force-opening", not
      // "collapse everything" — it falls through to the (empty) collapsed list.
      expect(isCategoryExpanded('Thesis', ['Operations'], true, true)).toBe(true)
    })
  })

  describe('loadCollapsedCategories / saveCollapsedCategories — per-project persistence', () => {
    it('returns an empty list for a project with no saved preference', () => {
      expect(loadCollapsedCategories('ember-box')).toEqual([])
    })

    it('round-trips a saved collapsed list for the correct project only', () => {
      saveCollapsedCategories('ember-box', ['Product', 'Operations'])
      expect(loadCollapsedCategories('ember-box')).toEqual(['Product', 'Operations'])
      expect(loadCollapsedCategories('other-co')).toEqual([])
    })

    it('never throws on corrupted stored JSON — falls back to empty', () => {
      window.localStorage.setItem('ainative-builder-artifact-rail-ember-box', '{not json')
      expect(loadCollapsedCategories('ember-box')).toEqual([])
    })

    it('a blank slug is a no-op, never throws', () => {
      expect(() => saveCollapsedCategories('', ['x'])).not.toThrow()
      expect(loadCollapsedCategories('')).toEqual([])
    })
  })

  describe('hasExplicitOverrideThisRun / markExplicitOverrideThisRun — session-scoped', () => {
    it('starts false for a fresh session', () => {
      expect(hasExplicitOverrideThisRun('ember-box')).toBe(false)
    })

    it('becomes true after marking, scoped to the correct project', () => {
      markExplicitOverrideThisRun('ember-box')
      expect(hasExplicitOverrideThisRun('ember-box')).toBe(true)
      expect(hasExplicitOverrideThisRun('other-co')).toBe(false)
    })

    it('clearExplicitOverrideThisRun resets it explicitly (a fresh tab/session already resets it naturally, since this is sessionStorage-backed)', () => {
      markExplicitOverrideThisRun('ember-box')
      clearExplicitOverrideThisRun('ember-box')
      expect(hasExplicitOverrideThisRun('ember-box')).toBe(false)
    })
  })
})
