import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AppHeader } from '@/components/shared/app-header'
import { Template } from '@/lib/types/template'

interface PageProps {
  params: Promise<{ slug: string }>
}

function slugToName(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

async function fetchTemplate(slug: string): Promise<Template | null> {
  const name = slugToName(slug)
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'}/api/templates?search=${encodeURIComponent(name)}`,
      { next: { revalidate: 3600 } }
    )
    if (!res.ok) return null
    const data = await res.json()
    const templates: Template[] = data.templates || []
    // Find closest match by name
    return (
      templates.find(
        (t) => t.name.toLowerCase().replace(/\s+/g, '-') === slug
      ) || templates[0] || null
    )
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const template = await fetchTemplate(slug)

  if (!template) {
    return {
      title: 'Template Not Found',
    }
  }

  const title = `AI ${template.category} Template - ${template.name} | AINative Builder`
  const description = `Use the ${template.name} AI ${template.category} template to instantly generate a production-ready app. ${template.description}`

  return {
    title,
    description,
    keywords: [
      `AI ${template.category} template`,
      `${template.name} template`,
      'AI app template',
      'React template generator',
      'AINative Builder',
      ...template.tags,
    ],
    openGraph: {
      title,
      description,
      type: 'website',
    },
    alternates: {
      canonical: `https://builder.ainative.studio/templates/${slug}`,
    },
  }
}

export default async function TemplatePage({ params }: PageProps) {
  const { slug } = await params
  const template = await fetchTemplate(slug)

  if (!template) {
    notFound()
  }

  const ctaHref = `/?prompt=${encodeURIComponent(`Create a ${template.category} using the ${template.name} template`)}`

  const complexityLabel: Record<string, string> = {
    simple: 'Simple',
    medium: 'Medium',
    advanced: 'Advanced',
  }

  const complexityColor: Record<string, string> = {
    simple: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    advanced: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: `${template.name} - AINative Builder Template`,
    description: template.description,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web',
    url: `https://builder.ainative.studio/templates/${slug}`,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    keywords: template.tags.join(', '),
  }

  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
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
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                complexityColor[template.metadata.complexity] || ''
              }`}
            >
              {complexityLabel[template.metadata.complexity] || template.metadata.complexity}
            </span>
          </div>

          <h1 className="text-4xl font-bold mb-4">{template.name}</h1>
          <p className="text-lg text-muted-foreground leading-relaxed">{template.description}</p>
        </div>

        {/* CTA */}
        <div className="mb-10">
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href={ctaHref}>Use This Template</Link>
          </Button>
        </div>

        {/* Tags */}
        {template.tags.length > 0 && (
          <div className="mb-8">
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
          </div>
        )}

        {/* Components used */}
        {template.metadata.components_used.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Components
            </h2>
            <div className="flex flex-wrap gap-2">
              {template.metadata.components_used.map((comp) => (
                <Badge key={comp} variant="outline" className="font-mono text-xs">
                  {comp}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Bottom CTA */}
        <div className="border-t pt-10 mt-10 text-center">
          <h2 className="text-2xl font-bold mb-3">Ready to build?</h2>
          <p className="text-muted-foreground mb-6">
            Generate a production-ready {template.category} app in seconds using this template.
          </p>
          <Button asChild size="lg">
            <Link href={ctaHref}>Use This Template</Link>
          </Button>
        </div>
      </main>
    </div>
  )
}
