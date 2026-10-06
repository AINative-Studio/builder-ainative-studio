import { describe, it, expect } from 'vitest'
import { isUsableDeepLinkCompany } from '@/contexts/build-context'

/**
 * builder#960 — THE ROOT CAUSE, pinned.
 *
 * contexts/build-context.tsx's deep-link effect seeds `idea`, `appSub` AND
 * `companyName` from the RAW `?company=` query param:
 *
 *   dispatch({ type: 'START_BUILD', idea: company, appSub: company, companyName: company })
 *
 * Live.tsx then posts `state.companyName` as `name` and `state.idea` as `idea`
 * to BOTH /api/build/company-app and /api/build/company-product, each of which
 * embeds both values verbatim in its real codegen prompt. So anything in
 * `?company=` becomes a real, billable generation AND a public showcase entry.
 *
 * Confirmed live: `/build?screen=live&company={slug}` — opened with the markdown
 * code-span's trailing backtick still attached, from a URL copied out of this
 * repo's own documentation — produced the two garbage showcase entries
 * (chat_ids x6wOHR9rN8UDxcUyTXElZ and 7W6siLoHGM8O4rsusuIQt, both 2026-09-23),
 * one per template, each titled literally `{slug}` + a backtick.
 *
 * Tested via the exported pure guard rather than by mounting BuildProvider,
 * which OOMs jsdom via useAutoplay (see build-context-url-sync-mount-race.test.ts).
 */
describe('isUsableDeepLinkCompany (builder#960)', () => {
  it('rejects the EXACT ?company= value that caused the live bug', () => {
    expect(isUsableDeepLinkCompany('{slug}`')).toBe(false)
  })

  it('rejects the placeholder without the trailing backtick', () => {
    expect(isUsableDeepLinkCompany('{slug}')).toBe(false)
  })

  it('rejects ${slug} template-literal syntax', () => {
    expect(isUsableDeepLinkCompany('${slug}')).toBe(false)
  })

  it('rejects an empty or whitespace-only company param', () => {
    expect(isUsableDeepLinkCompany('')).toBe(false)
    expect(isUsableDeepLinkCompany('   ')).toBe(false)
    expect(isUsableDeepLinkCompany(null)).toBe(false)
    expect(isUsableDeepLinkCompany(undefined)).toBe(false)
  })

  // Real slugs come from lib/build/slug.ts's toSlug (lowercase alnum +
  // hyphens), so no legitimate deep link can contain braces or a backtick —
  // but these must all still pass, or a real founder gets bounced off their
  // own dashboard.
  it.each([
    'meridian',
    'chili-crate',
    'chili-crate-product',
    'acme-2',
    'slug-x6wOHR',
    'app',
  ])('accepts the real deep-link slug %s', (slug) => {
    expect(isUsableDeepLinkCompany(slug)).toBe(true)
  })
})
