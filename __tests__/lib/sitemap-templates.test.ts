/**
 * Ensures every individually indexable template landing page (Issue #34) is
 * present in the sitemap so search engines discover them.
 */

import { describe, it, expect } from 'vitest'
import sitemap from '@/app/sitemap'
import { TEMPLATE_SLUGS } from '@/lib/data/seo-templates'

describe('sitemap — template landing pages', () => {
  const entries = sitemap()
  const urls = entries.map((e) => e.url)

  it('includes a URL for every template slug', () => {
    for (const slug of TEMPLATE_SLUGS) {
      expect(urls).toContain(`https://builder.ainative.studio/templates/${slug}`)
    }
  })

  it('includes the templates index page', () => {
    expect(urls).toContain('https://builder.ainative.studio/templates')
  })

  it('emits no duplicate URLs', () => {
    expect(new Set(urls).size).toBe(urls.length)
  })
})
