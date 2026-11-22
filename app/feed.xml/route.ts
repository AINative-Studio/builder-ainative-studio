/**
 * GET /feed.xml (#2218, AX "Machine-Readable Content" gap, 2/3) — a real
 * RSS 2.0 feed over Builder's genuine long-form articles
 * (lib/data/seo-guides.ts's GUIDES, the SAME single source of truth
 * app/guides/[slug]/page.tsx, app/guides/page.tsx, and app/sitemap.ts
 * already render from — never a second hardcoded article list, so a new
 * guide added there appears here automatically with no extra step).
 *
 * Real dates (datePublished/dateModified), real titles/excerpts, real
 * canonical URLs matching sitemap.ts's own `${baseUrl}/guides/${slug}`
 * pattern — nothing fabricated. Advertised via the real
 * <link rel="alternate" type="application/rss+xml"> tag in app/layout.tsx's
 * metadata (`alternates.types`).
 */

import { GUIDES } from '@/lib/data/seo-guides'

const SITE = 'https://builder.ainative.studio'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function toRfc822(isoDate: string): string {
  const parsed = new Date(isoDate)
  return Number.isNaN(parsed.getTime()) ? new Date().toUTCString() : parsed.toUTCString()
}

export async function GET() {
  const sorted = [...GUIDES].sort(
    (a, b) => new Date(b.datePublished).getTime() - new Date(a.datePublished).getTime(),
  )

  const items = sorted
    .map((guide) => {
      const url = `${SITE}/guides/${guide.slug}`
      return `    <item>
      <title>${escapeXml(guide.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <description>${escapeXml(guide.excerpt)}</description>
      <pubDate>${toRfc822(guide.datePublished)}</pubDate>
      <category>${escapeXml(guide.category)}</category>
    </item>`
    })
    .join('\n')

  const mostRecentUpdate = sorted.length > 0 ? toRfc822(sorted[0].dateModified) : new Date().toUTCString()

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>AINative Builder Guides</title>
    <link>${SITE}/guides</link>
    <description>Practical guides on building, launching, and running software with AI — AINative Builder.</description>
    <language>en-us</language>
    <lastBuildDate>${mostRecentUpdate}</lastBuildDate>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
