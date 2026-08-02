/**
 * Ensures every blog/guides article (Issue #35) is present in the sitemap so
 * search engines discover them, and that the /guides index is listed too.
 */

import { describe, it, expect } from 'vitest'
import sitemap from '@/app/sitemap'
import { GUIDE_SLUGS } from '@/lib/data/seo-guides'

describe('sitemap — guides articles', () => {
  const entries = sitemap()
  const urls = entries.map((e) => e.url)

  it('includes a URL for every guide slug', () => {
    for (const slug of GUIDE_SLUGS) {
      expect(urls).toContain(`https://builder.ainative.studio/guides/${slug}`)
    }
  })

  it('includes the guides index page', () => {
    expect(urls).toContain('https://builder.ainative.studio/guides')
  })

  it('emits no duplicate URLs', () => {
    expect(new Set(urls).size).toBe(urls.length)
  })
})
