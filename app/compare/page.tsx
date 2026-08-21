import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AppHeader } from '@/components/shared/app-header'

// Crawlable index for the /compare/[competitor] pages. Keeps the "X alternative"
// SEO intent reachable from a single hub and reinforces the pivot positioning:
// AINative doesn't just generate code — it builds AND runs your company.
// Slugs here MUST match COMPETITORS in app/compare/[competitor]/page.tsx.

interface CompareTarget {
  slug: string
  name: string
  // How the market frames the competitor, and the one-line "why switch".
  kind: 'builder' | 'company'
  blurb: string
}

const COMPARE_TARGETS: CompareTarget[] = [
  {
    slug: 'polsia',
    name: 'Polsia',
    kind: 'company',
    blurb:
      'Polsia runs a company for you, but you bring the product — and it is a closed, client-rendered system. AINative builds the product first, then runs it 24/7 on real primitives you own.',
  },
  {
    slug: 'v0',
    name: 'v0 by Vercel',
    kind: 'builder',
    blurb:
      'v0 generates UI on GPT-4o alone. AINative composes a real running product and the operating company around it — multi-model, agent-native, and yours to keep.',
  },
  {
    slug: 'lovable',
    name: 'Lovable',
    kind: 'builder',
    blurb:
      'Lovable stops at a generated app. AINative goes further: a production-ready app plus CRM, billing, helpdesk and voice — then runs the whole thing while you sleep.',
  },
  {
    slug: 'bolt',
    name: 'Bolt.new',
    kind: 'builder',
    blurb:
      'Bolt.new is a code generator. AINative is an AI co-founder that builds AND runs your company on real, open primitives with automatic SEO and AX optimization.',
  },
  {
    slug: 'base44',
    name: 'Base44',
    kind: 'builder',
    blurb:
      'Base44 builds apps on a single model with no agent optimization. AINative is multi-model, agent-native, open-source, and operates your company autonomously.',
  },
]

export const metadata: Metadata = {
  title: 'AINative Builder Alternatives — Compare vs Polsia, v0, Lovable, Bolt, Base44',
  description:
    'Compare AINative Builder to Polsia, v0, Lovable, Bolt.new, and Base44. See why the AI that BUILDS and RUNS your company — on real, open primitives you own — beats code generators and closed autonomous-company tools.',
  keywords: [
    'AINative Builder alternatives',
    'Polsia alternative',
    'v0 alternative',
    'Lovable alternative',
    'Bolt.new alternative',
    'Base44 alternative',
    'AI that runs your company',
    'AI co-founder',
    'best AI app builder 2026',
  ],
  alternates: { canonical: 'https://builder.ainative.studio/compare' },
  openGraph: {
    title: 'AINative Builder vs Polsia, v0, Lovable, Bolt & Base44',
    description:
      'The AI that builds AND runs your company, compared side-by-side with the code generators and autonomous-company tools you already know.',
    type: 'website',
  },
}

const itemListJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'AINative Builder comparisons',
  itemListElement: COMPARE_TARGETS.map((t, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: `AINative Builder vs ${t.name}`,
    url: `https://builder.ainative.studio/compare/${t.slug}`,
  })),
}

export default function CompareIndexPage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />
      <AppHeader />

      <main>
        {/* Hero */}
        <section className="container mx-auto px-4 py-16 text-center max-w-4xl">
          <Badge variant="secondary" className="mb-4">
            Comparisons
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
            How AINative Builder compares
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Most tools either generate code or run a company you already have. AINative does
            both — Cody, your AI co-founder, builds the product AND the operating company on real,
            open primitives you own, then runs it 24/7. See how it stacks up.
          </p>
          <Button asChild size="lg">
            <Link href="/build">Build your company free →</Link>
          </Button>
        </section>

        {/* Comparison list */}
        <section className="container mx-auto px-4 pb-16 max-w-4xl">
          <h2 className="text-2xl font-bold mb-8 text-center">Side-by-side comparisons</h2>
          <ul className="grid gap-6 md:grid-cols-2">
            {COMPARE_TARGETS.map((t) => (
              <li key={t.slug}>
                <Link
                  href={`/compare/${t.slug}`}
                  className="block h-full border rounded-lg p-6 transition-colors hover:border-primary hover:bg-muted/30"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-lg">
                      AINative Builder vs {t.name}
                    </h3>
                    <Badge variant="outline">
                      {t.kind === 'company' ? 'Runs your company' : 'Code generator'}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">{t.blurb}</p>
                  <span className="mt-4 inline-block text-primary font-medium">
                    Compare AINative vs {t.name} →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* Category context — keeps non-branded intent reachable */}
        <section className="container mx-auto px-4 pb-16 max-w-3xl text-center">
          <h2 className="text-2xl font-bold mb-4">Looking for the bigger picture?</h2>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            These comparisons focus on individual tools. If you want to understand the category —
            an AI that builds AND runs your company autonomously — start here.
          </p>
          <Button asChild variant="outline" size="lg">
            <Link href="/ai-company">See what an AI co-founder can do →</Link>
          </Button>
        </section>

        {/* Bottom CTA */}
        <section className="border-t bg-muted/30">
          <div className="container mx-auto px-4 py-16 text-center max-w-2xl">
            <h2 className="text-3xl font-bold mb-4">Ready to switch?</h2>
            <p className="text-muted-foreground mb-8">
              Describe an idea and watch Cody build a real, production-ready company on primitives
              you own — then run it while you sleep.
            </p>
            <Button asChild size="lg">
              <Link href="/build">Build your company free →</Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  )
}
