import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { AppHeader } from '@/components/shared/app-header'
import { GUIDES } from '@/lib/data/seo-guides'

const BASE_URL = 'https://builder.ainative.studio'

export const metadata: Metadata = {
  title: 'Guides & Tutorials — Build Apps with AI | AINative Builder',
  description:
    'Long-form guides on building SaaS with AI, AI app builder comparisons (v0 vs Lovable vs AINative), AX optimization, and SEO best practices for AI-generated apps.',
  keywords: [
    'AI app builder guides',
    'how to build a SaaS with AI',
    'v0 vs Lovable vs AINative',
    'what is AX optimization',
    'SEO for AI-generated apps',
    'AINative Builder tutorials',
  ],
  openGraph: {
    title: 'Guides & Tutorials — Build Apps with AI | AINative Builder',
    description:
      'Long-form guides on building SaaS with AI, builder comparisons, AX optimization, and SEO best practices.',
    type: 'website',
    url: `${BASE_URL}/guides`,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Guides & Tutorials — Build Apps with AI | AINative Builder',
    description:
      'Long-form guides on building SaaS with AI, builder comparisons, AX optimization, and SEO best practices.',
  },
  alternates: {
    canonical: `${BASE_URL}/guides`,
  },
}

const categoryColor: Record<string, string> = {
  Tutorial: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  Comparison: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  Concept: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  'Best Practices': 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
}

export default function GuidesIndexPage() {
  // ItemList structured data helps search engines understand the article hub.
  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'AINative Builder Guides',
    itemListElement: GUIDES.map((guide, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${BASE_URL}/guides/${guide.slug}`,
      name: guide.title,
    })),
  }

  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />
      <AppHeader />

      <main className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-10 text-center">
          <Badge variant="secondary" className="mb-4">
            Guides &amp; Tutorials
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Learn to build apps with AI
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            In-depth guides on building SaaS with AI, comparing AI app builders,
            optimizing for AI agents (AX), and making AI-generated apps rank in
            search.
          </p>
        </div>

        {/* Article grid */}
        <div className="grid gap-6 sm:grid-cols-2">
          {GUIDES.map((guide) => (
            <Link
              key={guide.slug}
              href={`/guides/${guide.slug}`}
              className="group flex flex-col rounded-lg border p-6 hover:border-primary hover:shadow-sm transition-all"
            >
              <div className="mb-3 flex items-center gap-3">
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    categoryColor[guide.category] ?? ''
                  }`}
                >
                  {guide.category}
                </span>
                <span className="text-xs text-muted-foreground">
                  {guide.readTimeMinutes} min read
                </span>
              </div>
              <h2 className="text-xl font-semibold mb-2 group-hover:text-primary transition-colors">
                {guide.title}
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                {guide.excerpt}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {guide.tags.slice(0, 3).map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
