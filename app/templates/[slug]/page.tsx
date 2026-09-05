import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AppHeader } from '@/components/shared/app-header'
import {
  SEO_TEMPLATES,
  TEMPLATE_SLUGS,
  getSeoTemplateBySlug,
  type SeoTemplate,
} from '@/lib/data/seo-templates'

interface PageProps {
  params: Promise<{ slug: string }>
}

const BASE_URL = 'https://builder.ainative.studio'

const complexityLabel: Record<SeoTemplate['complexity'], string> = {
  simple: 'Simple',
  medium: 'Medium',
  advanced: 'Advanced',
}

const complexityColor: Record<SeoTemplate['complexity'], string> = {
  simple: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  advanced: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

// Statically pre-render one page per template so every entry is crawlable and
// indexable without hitting the database at request time.
export function generateStaticParams() {
  return TEMPLATE_SLUGS.map((slug) => ({ slug }))
}

export const dynamicParams = false

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const template = getSeoTemplateBySlug(slug)

  if (!template) {
    return { title: 'Template Not Found | AINative Builder' }
  }

  const title = `AI ${template.category} template — ${template.name} | AINative Builder`
  const description = `${template.tagline} ${template.description}`.slice(0, 300)

  return {
    title,
    description,
    keywords: [
      ...template.keywords,
      `${template.name} template`,
      'AI app template',
      'React template generator',
      'AINative Builder',
      ...template.tags,
    ],
    openGraph: {
      title,
      description: template.tagline,
      type: 'website',
      url: `${BASE_URL}/templates/${slug}`,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: template.tagline,
    },
    alternates: {
      canonical: `${BASE_URL}/templates/${slug}`,
    },
  }
}

export default async function TemplatePage({ params }: PageProps) {
  const { slug } = await params
  const template = getSeoTemplateBySlug(slug)

  if (!template) {
    notFound()
  }

  const ctaHref = `/?prompt=${encodeURIComponent(template.prompt)}`

  // Related templates in the same category (fall back to any others).
  const related = SEO_TEMPLATES.filter(
    (t) => t.slug !== template.slug && t.category === template.category
  )
  const relatedTemplates = (
    related.length > 0
      ? related
      : SEO_TEMPLATES.filter((t) => t.slug !== template.slug)
  ).slice(0, 3)

  const jsonLd = {
    '@context': 'https://schema.org',
    // Product (not SoftwareApplication) — that type requires a star rating for
    // Google Rich Results eligibility, and we never fabricate one (#517).
    '@type': 'Product',
    name: `${template.name} — AINative Builder Template`,
    description: template.description,
    category: 'DeveloperApplication',
    url: `${BASE_URL}/templates/${slug}`,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    keywords: template.keywords.join(', '),
    additionalProperty: template.features.map((f) => ({
      '@type': 'PropertyValue',
      name: 'feature',
      value: f.title,
    })),
  }

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Templates', item: `${BASE_URL}/templates` },
      {
        '@type': 'ListItem',
        position: 2,
        name: template.name,
        item: `${BASE_URL}/templates/${slug}`,
      },
    ],
  }

  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <AppHeader />

      <main className="container mx-auto px-4 py-12 max-w-3xl">
        {/* Breadcrumb */}
        <nav className="text-sm text-muted-foreground mb-8" aria-label="Breadcrumb">
          <Link href="/templates" className="hover:text-foreground transition-colors">
            Templates
          </Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{template.name}</span>
        </nav>

        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Badge variant="secondary" className="capitalize">
              {template.category}
            </Badge>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${complexityColor[template.complexity]}`}
            >
              {complexityLabel[template.complexity]}
            </span>
          </div>

          <h1 className="text-4xl font-bold mb-4">
            AI {template.category} template: {template.name}
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            {template.description}
          </p>
        </div>

        {/* CTA */}
        <div className="mb-12">
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href={ctaHref}>Use This Template</Link>
          </Button>
        </div>

        {/* Code preview */}
        <section className="mb-12">
          <h2 className="text-xl font-bold mb-4">Preview</h2>
          <div className="rounded-lg border bg-muted/40 overflow-hidden">
            <div className="flex items-center gap-1.5 px-4 py-2.5 border-b bg-muted/60">
              <span className="h-3 w-3 rounded-full bg-red-400" />
              <span className="h-3 w-3 rounded-full bg-yellow-400" />
              <span className="h-3 w-3 rounded-full bg-green-400" />
              <span className="ml-3 text-xs text-muted-foreground font-mono">
                {template.slug}.tsx
              </span>
            </div>
            <pre className="p-4 overflow-x-auto text-sm">
              <code className="font-mono">{template.codePreview}</code>
            </pre>
          </div>
        </section>

        {/* Features */}
        <section className="mb-12">
          <h2 className="text-xl font-bold mb-4">What&apos;s included</h2>
          <ul className="space-y-4">
            {template.features.map((feature) => (
              <li key={feature.title} className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs"
                >
                  ✓
                </span>
                <div>
                  <h3 className="font-semibold">{feature.title}</h3>
                  <p className="text-muted-foreground text-sm">{feature.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Use cases */}
        <section className="mb-12">
          <h2 className="text-xl font-bold mb-4">Perfect for</h2>
          <div className="flex flex-wrap gap-2">
            {template.useCases.map((useCase) => (
              <Badge key={useCase} variant="outline" className="text-sm py-1">
                {useCase}
              </Badge>
            ))}
          </div>
        </section>

        {/* Tags */}
        {template.tags.length > 0 && (
          <section className="mb-12">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Tags
            </h2>
            <div className="flex flex-wrap gap-2">
              {template.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          </section>
        )}

        {/* Components used */}
        {template.componentsUsed.length > 0 && (
          <section className="mb-12">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Components
            </h2>
            <div className="flex flex-wrap gap-2">
              {template.componentsUsed.map((comp) => (
                <Badge key={comp} variant="outline" className="font-mono text-xs">
                  {comp}
                </Badge>
              ))}
            </div>
          </section>
        )}

        {/* Related templates — internal linking for SEO */}
        {relatedTemplates.length > 0 && (
          <section className="border-t pt-10 mb-4">
            <h2 className="text-xl font-bold mb-6">Related templates</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {relatedTemplates.map((rel) => (
                <Link
                  key={rel.slug}
                  href={`/templates/${rel.slug}`}
                  className="rounded-lg border p-4 hover:border-primary hover:shadow-sm transition-all"
                >
                  <Badge variant="secondary" className="capitalize mb-2 text-xs">
                    {rel.category}
                  </Badge>
                  <h3 className="font-semibold mb-1">{rel.name}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-2">{rel.tagline}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Bottom CTA */}
        <div className="border-t pt-10 mt-10 text-center">
          <h2 className="text-2xl font-bold mb-3">Ready to build?</h2>
          <p className="text-muted-foreground mb-6">
            Generate a production-ready {template.category} app in seconds using the{' '}
            {template.name} template.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg">
              <Link href={ctaHref}>Use This Template</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/templates">Browse all templates</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}
