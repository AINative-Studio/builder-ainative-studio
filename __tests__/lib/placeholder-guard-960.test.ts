import { describe, it, expect } from 'vitest'
import { looksLikeUnsubstitutedPlaceholder } from '@/lib/build/placeholder-guard'

/**
 * builder#960 — two live public showcase entries were titled, literally,
 * `{slug}` plus a trailing backtick, because a `?company=` deep-link value
 * copied verbatim out of this repo's own documentation (markdown code-span
 * backtick included) was seeded straight into `state.companyName`/`state.idea`
 * and from there into both company-track codegen prompts.
 *
 * These tests pin the guard's behavior from BOTH directions: it must catch the
 * exact real-world value, and it must never reject a real founder's company
 * name or idea (a false positive silently blocks a paying customer's build,
 * which is strictly worse than the cosmetic bug being fixed).
 */
describe('looksLikeUnsubstitutedPlaceholder (builder#960)', () => {
  it('catches the EXACT value found live: {slug} plus the markdown code-span backtick', () => {
    expect(looksLikeUnsubstitutedPlaceholder('{slug}`')).toBe(true)
  })

  it('catches the placeholder without the stray backtick', () => {
    expect(looksLikeUnsubstitutedPlaceholder('{slug}')).toBe(true)
  })

  it('catches JS template-literal syntax (${slug})', () => {
    expect(looksLikeUnsubstitutedPlaceholder('${slug}')).toBe(true)
  })

  it('catches a placeholder embedded mid-string, not just a bare one', () => {
    expect(looksLikeUnsubstitutedPlaceholder('company={slug}')).toBe(true)
    expect(looksLikeUnsubstitutedPlaceholder('Acme {name} Co')).toBe(true)
  })

  it('catches other brace placeholder names, not just "slug"', () => {
    expect(looksLikeUnsubstitutedPlaceholder('{companyName}')).toBe(true)
    expect(looksLikeUnsubstitutedPlaceholder('{idea}')).toBe(true)
    expect(looksLikeUnsubstitutedPlaceholder('{}')).toBe(true)
  })

  it('catches a lone stray backtick (a copied code-span delimiter)', () => {
    expect(looksLikeUnsubstitutedPlaceholder('acme`')).toBe(true)
  })

  it('treats empty/missing as NOT a placeholder (callers handle emptiness themselves)', () => {
    expect(looksLikeUnsubstitutedPlaceholder('')).toBe(false)
    expect(looksLikeUnsubstitutedPlaceholder('   ')).toBe(false)
    expect(looksLikeUnsubstitutedPlaceholder(null)).toBe(false)
    expect(looksLikeUnsubstitutedPlaceholder(undefined)).toBe(false)
  })

  // The false-positive direction matters more than the true-positive one:
  // rejecting a real founder's build is a worse outcome than a cosmetic
  // showcase title. Every value below is a realistic company name, slug, or
  // founder-written idea and MUST pass.
  it.each([
    'Meridian',
    'meridian',
    'chili-crate',
    'slug-x6wOHR', // a real derived showcase slug — braceless, must pass
    "O'Brien & Sons",
    'Acme (Holdings) Ltd.',
    'Twenty-Four/Seven',
    'a personalized business advisor that analyzes sales pipeline data to forecast revenue',
    'I want to build a marketplace for volunteer firefighters',
    'An app that tracks habits — daily, weekly, monthly',
    'Café Müller',
    'C++ tutoring platform',
    '100% Organic',
    'Build an app for $5/month subscriptions',
  ])('does NOT flag a real company name or idea: %s', (real) => {
    expect(looksLikeUnsubstitutedPlaceholder(real)).toBe(false)
  })

  it('does not flag a bare $ or bare braces-free punctuation', () => {
    expect(looksLikeUnsubstitutedPlaceholder('$Cashflow')).toBe(false)
    expect(looksLikeUnsubstitutedPlaceholder('cost: $19')).toBe(false)
  })
})
