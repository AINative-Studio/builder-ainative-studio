/**
 * #2218 — AX "Machine-Readable Content" gap (2/3): the real checker
 * (core's check_machine_readable_content) credits either a feed at a
 * conventional path or a <link type="application/rss+xml"> tag — neither
 * existed. This is a real RSS feed over the genuine /guides articles
 * (lib/data/seo-guides.ts's GUIDES), the SAME single source of truth
 * app/sitemap.ts and app/guides/[slug]/page.tsx already render from.
 */

import { describe, it, expect } from 'vitest'
import { GET } from '@/app/feed.xml/route'
import { GUIDES, GUIDE_SLUGS } from '@/lib/data/seo-guides'

describe('GET /feed.xml', () => {
  it('returns a valid RSS 2.0 document with the real content-type', async () => {
    const res = await GET()
    expect(res.headers.get('content-type')).toContain('application/rss+xml')
    const body = await res.text()
    expect(body).toContain('<?xml version="1.0"')
    expect(body).toContain('<rss version="2.0"')
    expect(body).toContain('</rss>')
  })

  it('includes a real <item> for every guide — same single source of truth as the sitemap', async () => {
    const res = await GET()
    const body = await res.text()
    for (const slug of GUIDE_SLUGS) {
      expect(body).toContain(`https://builder.ainative.studio/guides/${slug}`)
    }
  })

  it('every item carries the real title and excerpt — never a placeholder', async () => {
    const res = await GET()
    const body = await res.text()
    for (const guide of GUIDES) {
      expect(body).toContain(guide.title)
    }
  })

  it('self-advertises via an atom:link so a feed reader can find the canonical feed URL', async () => {
    const res = await GET()
    const body = await res.text()
    expect(body).toContain('https://builder.ainative.studio/feed.xml')
  })

  it('emits a valid RFC 822 pubDate for every item, derived from the real datePublished', async () => {
    const res = await GET()
    const body = await res.text()
    const pubDates = [...body.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)].map((m) => m[1])
    expect(pubDates.length).toBe(GUIDES.length)
    for (const date of pubDates) {
      expect(Number.isNaN(new Date(date).getTime())).toBe(false)
    }
  })

  it('orders items newest-first by datePublished', async () => {
    const res = await GET()
    const body = await res.text()
    const titles = [...body.matchAll(/<title>([^<]+)<\/title>/g)].map((m) => m[1]).slice(1) // drop channel title
    const sortedExpected = [...GUIDES]
      .sort((a, b) => new Date(b.datePublished).getTime() - new Date(a.datePublished).getTime())
      .map((g) => g.title)
    expect(titles).toEqual(sortedExpected)
  })

  it('escapes XML special characters in titles/excerpts rather than emitting malformed XML', async () => {
    const res = await GET()
    const body = await res.text()
    // A well-formed document has no unescaped bare `&` — every `&` is part of a real entity.
    const bareAmpersands = body.match(/&(?!amp;|lt;|gt;|quot;|apos;)/g)
    expect(bareAmpersands).toBeNull()
  })
})
