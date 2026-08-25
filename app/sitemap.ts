import { MetadataRoute } from 'next'
import { SEED_SHOWCASE } from '@/lib/showcase-data'
import { TEMPLATE_SLUGS } from '@/lib/data/seo-templates'
import { GUIDE_SLUGS } from '@/lib/data/seo-guides'

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
  const compareEntries: MetadataRoute.Sitemap = ['v0', 'lovable', 'bolt', 'base44', 'polsia'].map(slug => ({
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

  // Blog/guides articles targeting long-tail keywords ("how to build a SaaS with
  // AI", "v0 vs Lovable vs AINative", "what is AX optimization"). One URL per
  // article; keep in sync with lib/data/seo-guides.ts.
  const guideEntries: MetadataRoute.Sitemap = GUIDE_SLUGS.map(slug => ({
    url: `${baseUrl}/guides/${slug}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }))

  // "Best" list pages targeting low-difficulty buyer-intent keywords.
  // Keep in sync with CATEGORIES in app/best/[category]/page.tsx.
  const bestEntries: MetadataRoute.Sitemap = ['ai-app-builder', 'vibe-coding-tools'].map(slug => ({
    url: `${baseUrl}/best/${slug}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.85,
  }))

  return [
    {
      url: baseUrl,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      // The pivot front door — highest-priority conversion page.
      url: `${baseUrl}/build`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      // Founder story + vision — trust/AEO asset; press and LLMs cite about pages.
      url: `${baseUrl}/about`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.85,
    },
    {
      // AI Help Center — self-serve support + crawlable FAQ (AEO/AX asset, #60).
      url: `${baseUrl}/help`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      // Category landing ("AI that runs your company") — non-branded demand.
      url: `${baseUrl}/ai-company`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      // Category landing ("autonomous company builder", "build a SaaS with AI
      // overnight") — non-branded buyer-intent demand (#216).
      url: `${baseUrl}/autonomous-company-builder`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      // Category landing ("AI co-founder", "AI employee") — non-branded
      // buyer-intent demand (#216).
      url: `${baseUrl}/ai-cofounder`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/showcase`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.95,
    },
    ...showcaseEntries,
    ...compareEntries,
    ...bestEntries,
    {
      url: `${baseUrl}/templates`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    ...templateEntries,
    {
      url: `${baseUrl}/guides`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.85,
    },
    ...guideEntries,
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
