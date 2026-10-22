import { describe, it, expect } from 'vitest'
import {
  detectUIType,
  enhancePromptWithIntent,
  getExampleCategory,
} from '@/lib/services/intent-detector.service'

/**
 * Issue #1201 — Coverage Phase 1 follow-up.
 *
 * lib/services/intent-detector.service.ts (US-032) had zero test coverage
 * despite being pure keyword-scoring logic with no I/O or dependencies at
 * all — a clean, high-value target.
 */
describe('#1201 lib/services/intent-detector.service', () => {
  describe('detectUIType', () => {
    it('detects dashboard with high confidence given 3+ matching keywords', () => {
      const result = detectUIType('Build me an analytics dashboard with charts and kpi metrics')
      expect(result.type).toBe('dashboard')
      expect(result.confidence).toBe(0.9)
      expect(result.keywords.length).toBeGreaterThanOrEqual(3)
      expect(result.typeSpecificInstructions).toContain('DASHBOARD REQUIREMENTS')
    })

    it('detects form with 0.7 confidence given exactly 2 matching keywords', () => {
      const result = detectUIType('Create a signup form')
      expect(result.type).toBe('form')
      expect(result.confidence).toBe(0.7)
    })

    it('detects a type with 0.5 confidence given exactly 1 matching keyword', () => {
      const result = detectUIType('I need a blog')
      expect(result.type).toBe('blog')
      expect(result.confidence).toBe(0.5)
    })

    it('returns unknown with 0 confidence when no keywords match', () => {
      const result = detectUIType('asdkjfh qwoeiru')
      expect(result.type).toBe('unknown')
      expect(result.confidence).toBe(0)
      expect(result.keywords).toEqual([])
      expect(result.typeSpecificInstructions).toBe('')
    })

    it('is case-insensitive', () => {
      const result = detectUIType('DASHBOARD with ANALYTICS and METRICS')
      expect(result.type).toBe('dashboard')
    })

    it('picks the type with the strictly highest score when multiple types match', () => {
      // ecommerce: product, cart, checkout (3) vs blog: blog (1)
      const result = detectUIType('an ecommerce product cart checkout page, also a blog')
      expect(result.type).toBe('ecommerce')
    })

    it('keeps the first-found leading type on an exact score tie (first strictly-greater wins)', () => {
      // dashboard keyword "dashboard" (1) vs form keyword "form" (1) — dashboard
      // is iterated first in UI_TYPE_KEYWORDS, and ties don't overwrite maxScore.
      const result = detectUIType('a dashboard and a form')
      expect(result.type).toBe('dashboard')
    })
  })

  describe('enhancePromptWithIntent', () => {
    it('appends type-specific instructions when confidence is sufficient', () => {
      const prompt = 'Build an analytics dashboard with charts and metrics'
      const enhanced = enhancePromptWithIntent(prompt)
      expect(enhanced).toContain(prompt)
      expect(enhanced).toContain('DASHBOARD REQUIREMENTS')
    })

    it('returns the prompt unchanged when confidence is below 0.5', () => {
      const prompt = 'asdkjfh qwoeiru'
      expect(enhancePromptWithIntent(prompt)).toBe(prompt)
    })

    it('returns the prompt unchanged when the detected type is unknown even with a passed-in detection', () => {
      const prompt = 'something vague'
      const detection = {
        type: 'unknown' as const,
        confidence: 0.9,
        keywords: [],
        typeSpecificInstructions: '',
      }
      expect(enhancePromptWithIntent(prompt, detection)).toBe(prompt)
    })

    it('uses a provided detection result instead of recomputing it', () => {
      const prompt = 'anything'
      const detection = {
        type: 'blog' as const,
        confidence: 0.9,
        keywords: ['blog'],
        typeSpecificInstructions: 'BLOG REQUIREMENTS: custom',
      }
      const enhanced = enhancePromptWithIntent(prompt, detection)
      expect(enhanced).toBe(`${prompt}\n\nBLOG REQUIREMENTS: custom`)
    })
  })

  describe('getExampleCategory', () => {
    it('maps unknown to the dashboard fallback category', () => {
      expect(getExampleCategory('unknown')).toBe('dashboard')
    })

    it('passes through every other type unchanged', () => {
      expect(getExampleCategory('ecommerce')).toBe('ecommerce')
      expect(getExampleCategory('blog')).toBe('blog')
      expect(getExampleCategory('admin')).toBe('admin')
    })
  })
})
