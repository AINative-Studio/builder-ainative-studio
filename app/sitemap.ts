import { MetadataRoute } from 'next'
import { SEED_SHOWCASE } from '@/lib/showcase-data'
import { TEMPLATE_SLUGS } from '@/lib/data/seo-templates'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://builder.ainative.studio'
  const now = new Date().toISOString()

  // Showcase entry pages — high SEO value
  const showcaseEntries: MetadataRoute.Sitemap = SEED_SHOWCASE.map(entry => ({
    url: `${baseUrl}/showcase/${entry.slug}`,
    lastModified: entry.createdAt || now,
    changeFrequency: 'weekly' as const,
    priority: entry.featured ? 0.9 : 0.8,
  }))

  // Competitor-comparison SEO pages ("<X> alternative") — high-intent search.
  // Keep in sync with COMPETITORS in app/compare/[competitor]/page.tsx.
  const compareEntries: MetadataRoute.Sitemap = ['v0', 'lovable', 'bolt', 'base44'].map(slug => ({
    url: `${baseUrl}/compare/${slug}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.85,
  }))

  // Individual template landing pages ("AI <category> template") — high-intent
  // search. One URL per template; keep in sync with lib/data/seo-templates.ts.
  const templateEntries: MetadataRoute.Sitemap = TEMPLATE_SLUGS.map(slug => ({
    url: `${baseUrl}/templates/${slug}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }))

  return [
    {
      url: baseUrl,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${baseUrl}/showcase`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.95,
    },
    ...showcaseEntries,
    ...compareEntries,
    {
      url: `${baseUrl}/templates`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    ...templateEntries,
    {
      url: `${baseUrl}/login`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${baseUrl}/register`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${baseUrl}/docs/components`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/templates/analytics`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/templates/submit`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.4,
    },
  ]
}
