import { describe, it, expect } from 'vitest'
import { parsePRDForBuildSteps } from '@/lib/prd-parser'

/**
 * Real bug found live (Meridian, https://builder.ainative.studio/build/meridian,
 * 2026-09-10): parsePRDForBuildSteps's keyword matching used to be a plain
 * substring search. The 'product' keyword (meant to detect an ecommerce
 * product-catalog page) matched "production-quality" — a phrase in
 * company-app/route.ts's own landing-page prompt template, since 'product'
 * is a genuine prefix of "production" — so EVERY Company-track landing page
 * request got a false "Products Page (/products)" build step, was scored as
 * a 2-page app by analyzeComplexity(), and the model was instructed to
 * build an unrelated product-catalog page it never actually needed
 * (confirmed live via Railway logs: "Pages: 2", "Creating Products Page
 * (/products)" for a plain single-page landing-page request).
 */
describe('parsePRDForBuildSteps — keyword matching uses real word boundaries (2026-09-10)', () => {
  it('"production-quality" does NOT falsely detect a Products Page', () => {
    const result = parsePRDForBuildSteps(
      'Build a polished, production-quality single-page marketing LANDING PAGE for "Meridian".',
    )
    expect(result.pages.map((p) => p.name)).not.toContain('Products Page')
  })

  it('a genuine mention of "products" still correctly detects a Products Page', () => {
    const result = parsePRDForBuildSteps('an online store where customers browse products and checkout')
    expect(result.pages.map((p) => p.name)).toContain('Products Page')
  })

  it('the singular "product" keyword also still matches on its own', () => {
    const result = parsePRDForBuildSteps('a page to manage a single product listing')
    expect(result.pages.map((p) => p.name)).toContain('Products Page')
  })

  it('the exact real company-app landing-page template produces zero false page detections', () => {
    // The real template shape (app/api/build/company-app/route.ts), post-fix.
    const message =
      'Build a polished, production-quality single-page marketing LANDING PAGE for "Meridian" ' +
      '(tagline: "Your business, clearly charted.") — a real company for this idea: ' +
      'A personalized business advisor that analyzes customer interactions, sales pipeline data, ' +
      'and market intelligence to forecast revenue and recommend strategic actions.. ' +
      'Include: a hero with the value prop and a "Get early access" CTA, a 3-feature section, ' +
      'a how-it-works section, pricing (3 tiers), and a footer. Use #2D6BE4 as the main accent color. ' +
      'Make it visually distinctive and specific to this company, with realistic copy — not a generic template.'
    const result = parsePRDForBuildSteps(message)
    expect(result.pages.map((p) => p.name)).toEqual(['Landing Page'])
  })

  it('component pattern matching is also boundary-safe (e.g. "card" does not match inside an unrelated word)', () => {
    const result = parsePRDForBuildSteps('a scorecard summary for the quarter')
    // 'card' is a genuine substring of "scorecard" but not a whole word there.
    expect(result.components).not.toContain('Card Component')
  })

  it('a genuine card mention still detects the Card Component', () => {
    const result = parsePRDForBuildSteps('a grid of product cards')
    expect(result.components).toContain('Card Component')
  })
})
