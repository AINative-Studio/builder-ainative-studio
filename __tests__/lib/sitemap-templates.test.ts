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

  // Real, live bug (found via a third-party technical SEO audit, 2026-09-06):
  // /templates/analytics and /templates/submit are both explicitly auth-gated
  // in middleware.ts ("Submit/analytics stay gated below") — every crawl of
  // these two sitemap URLs 307-redirected to /login. A sitemap must only ever
  // list URLs that resolve 200 for an anonymous crawler.
  it('never lists the auth-gated /templates/analytics or /templates/submit routes', () => {
    expect(urls).not.toContain('https://builder.ainative.studio/templates/analytics')
    expect(urls).not.toContain('https://builder.ainative.studio/templates/submit')
  })

  // /capabilities is a real, public, middleware-allowlisted page (#313/#316)
  // that was missing from the sitemap entirely — found via the 2026-09-07 AEO
  // gap analysis.
  it('includes the /capabilities page', () => {
    expect(urls).toContain('https://builder.ainative.studio/capabilities')
  })
})
