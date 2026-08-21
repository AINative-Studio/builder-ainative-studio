import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AppHeader } from '@/components/shared/app-header'

interface PageProps {
  params: Promise<{ competitor: string }>
}

const COMPETITORS = ['v0', 'lovable', 'bolt', 'base44', 'polsia'] as const
type CompetitorSlug = (typeof COMPETITORS)[number]

interface CompetitorData {
  displayName: string
  models: string
  ax: string
  seo: string
  pricing: string
  opensource: string
  streaming: string
  // "company" competitors (Polsia) get the build-AND-run framing instead of the
  // code-generator framing.
  kind?: 'builder' | 'company'
  buildsApp?: string
  runsCompany?: string
  realPrimitives?: string
  agentFiles?: string
}

const COMPETITOR_DATA: Record<CompetitorSlug, CompetitorData> = {
  v0: {
    displayName: 'v0 by Vercel',
    models: 'GPT-4o only',
    ax: 'No',
    seo: 'None',
    pricing: 'Free + $20/mo',
    opensource: 'No',
    streaming: 'Yes',
  },
  lovable: {
    displayName: 'Lovable',
    models: 'GPT-4o only',
    ax: 'No',
    seo: 'None',
    pricing: 'Free + $25/mo',
    opensource: 'No',
    streaming: 'Yes',
  },
  bolt: {
    displayName: 'Bolt.new',
    models: 'Claude + limited',
    ax: 'No',
    seo: 'None',
    pricing: 'Free + $20/mo',
    opensource: 'No',
    streaming: 'Yes',
  },
  base44: {
    displayName: 'Base44',
    models: 'GPT-4o only',
    ax: 'No',
    seo: 'None',
    pricing: '$49/mo',
    opensource: 'No',
    streaming: 'No',
  },
  polsia: {
    displayName: 'Polsia',
    kind: 'company',
    models: 'Proprietary agents',
    ax: 'No — pure CSR, no llms.txt/agents.txt',
    seo: 'Client-rendered (invisible to crawlers/LLMs)',
    pricing: 'Subscription',
    opensource: 'No',
    streaming: 'Yes (demo)',
    buildsApp: 'Runs your company, but you bring the product',
    runsCompany: 'Yes — autonomous agents',
    realPrimitives: 'Proprietary, closed',
    agentFiles: 'None (no llms.txt / agents.txt / robots.txt)',
  },
}

const AINATIVE_DATA = {
  models: 'Claude Sonnet/Haiku/Opus 4.5 (Bedrock), tiered',
  ax: 'Yes — llms.txt, agents.txt, JSON-LD, semantic HTML',
  seo: 'Automatic JSON-LD, sitemap, crawlable pages',
  pricing: '72h trial, then $49/mo',
  opensource: 'Yes',
  streaming: 'Yes',
  buildsApp: 'Yes — real, production-ready app on a shareable URL',
  runsCompany: 'Yes — nightly autonomous loop',
  realPrimitives: 'ZeroDB, ZeroPipeline, ZeroInvoice, ServiceOS, ZeroVoice, Agent Cloud',
  agentFiles: 'llms.txt + agents.txt + robots.txt (agent-native)',
}

interface FeatureRow {
  feature: string
  ainative: string
  competitor: (data: CompetitorData) => string
  ainativeWins: boolean
}

// Rows shown ONLY for "company" competitors (Polsia) — the build-AND-run framing.
const COMPANY_ROWS: FeatureRow[] = [
  {
    feature: 'Builds the product for you',
    ainative: AINATIVE_DATA.buildsApp,
    competitor: (d) => d.buildsApp ?? '—',
    ainativeWins: true,
  },
  {
    feature: 'Runs the company (autonomous)',
    ainative: AINATIVE_DATA.runsCompany,
    competitor: (d) => d.runsCompany ?? '—',
    ainativeWins: false,
  },
  {
    feature: 'Built on real, open primitives you own',
    ainative: AINATIVE_DATA.realPrimitives,
    competitor: (d) => d.realPrimitives ?? '—',
    ainativeWins: true,
  },
  {
    feature: 'Agent-native (llms.txt / agents.txt)',
    ainative: AINATIVE_DATA.agentFiles,
    competitor: (d) => d.agentFiles ?? '—',
    ainativeWins: true,
  },
]

const FEATURE_ROWS: FeatureRow[] = [
  {
    feature: 'AI model options',
    ainative: AINATIVE_DATA.models,
    competitor: (d) => d.models,
    ainativeWins: true,
  },
  {
    feature: 'AX / Agent optimization',
    ainative: AINATIVE_DATA.ax,
    competitor: (d) => d.ax,
    ainativeWins: true,
  },
  {
    feature: 'SEO & structured data',
    ainative: AINATIVE_DATA.seo,
    competitor: (d) => d.seo,
    ainativeWins: true,
  },
  {
    feature: 'Pricing',
    ainative: AINATIVE_DATA.pricing,
    competitor: (d) => d.pricing,
    ainativeWins: false,
  },
  {
    feature: 'Open source',
    ainative: AINATIVE_DATA.opensource,
    competitor: (d) => d.opensource,
    ainativeWins: true,
  },
  {
    feature: 'Real-time streaming',
    ainative: AINATIVE_DATA.streaming,
    competitor: (d) => d.streaming,
    ainativeWins: false,
  },
]

export function generateStaticParams() {
  return COMPETITORS.map((competitor) => ({ competitor }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { competitor } = await params

  if (!COMPETITORS.includes(competitor as CompetitorSlug)) {
    return { title: 'Not Found' }
  }

  const data = COMPETITOR_DATA[competitor as CompetitorSlug]
  const title = `AINative Builder vs ${data.displayName} - Best Alternative 2026`
  const description = `Compare AINative Builder vs ${data.displayName}. AINative offers multi-model AI (Claude, Qwen, Gemma, DeepSeek), built-in AX optimization, automatic SEO, and open-source code — features ${data.displayName} doesn't provide.`

  return {
    title,
    description,
    keywords: [
      `${competitor} alternative`,
      `${data.displayName} alternative`,
      `AINative vs ${data.displayName}`,
      'best AI app builder 2026',
      'AI UI generator alternative',
    ],
    openGraph: {
      title,
      description,
      type: 'website',
    },
    alternates: {
      canonical: `https://builder.ainative.studio/compare/${competitor}`,
    },
  }
}

export default async function CompetitorPage({ params }: PageProps) {
  const { competitor } = await params

  if (!COMPETITORS.includes(competitor as CompetitorSlug)) {
    notFound()
  }

  const data = COMPETITOR_DATA[competitor as CompetitorSlug]
  // Company competitors (Polsia) lead with the build-AND-run rows.
  const rows = data.kind === 'company' ? [...COMPANY_ROWS, ...FEATURE_ROWS] : FEATURE_ROWS

  const companyFaq = [
    {
      '@type': 'Question',
      name: `What is the difference between AINative Builder and ${data.displayName}?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `${data.displayName} runs your company autonomously, but you have to bring the product. AINative Builder BUILDS the company first — a real, production-ready app on a shareable URL plus the operating business systems (CRM via ZeroPipeline, billing via ZeroInvoice, helpdesk via ServiceOS, voice via ZeroVoice) — and THEN runs it on a nightly autonomous loop. You watch every artifact get composed live and you own 100% of what is built.`,
      },
    },
    {
      '@type': 'Question',
      name: `Is AINative Builder a good ${data.displayName} alternative?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `Yes. If you want an AI that both builds AND runs your company on real, open primitives you own — not a closed, proprietary agent — AINative Builder is the stronger choice. It's agent-native (llms.txt, agents.txt, crawlable pages), whereas ${data.displayName} is a client-rendered app with no agent files, invisible to LLMs and crawlers.`,
      },
    },
    {
      '@type': 'Question',
      name: `Does ${data.displayName} build real production-ready apps?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `${data.displayName} focuses on operating a company with autonomous agents. AINative Builder generates a real, idea-specific app deployed to a durable, shareable URL, plus real business systems backed by AINative products — not mockups.`,
      },
    },
  ]
  const builderFaq = [
    {
      '@type': 'Question',
      name: `What is the difference between AINative Builder and ${data.displayName}?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `AINative Builder supports multiple AI models including Claude, Qwen, Gemma, and DeepSeek, while ${data.displayName} uses ${data.models}. AINative also includes built-in AX (Agent Experience) optimization and automatic SEO with structured data — features not available in ${data.displayName}.`,
      },
    },
    {
      '@type': 'Question',
      name: `Is AINative Builder a good ${data.displayName} alternative?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `Yes. AINative Builder is a strong alternative to ${data.displayName} for developers who need multi-model flexibility, agent-optimized output, automatic SEO, and open-source access. It starts with a 7-day trial on the Hobbyist plan, with professional plans from $49/mo.`,
      },
    },
    {
      '@type': 'Question',
      name: `Does AINative Builder support the same features as ${data.displayName}?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `AINative Builder supports all core features of ${data.displayName} such as real-time streaming and React component generation, and adds unique capabilities: multi-model AI selection, AX scoring for agent accessibility, automatic JSON-LD structured data, and an open-source codebase.`,
      },
    },
  ]
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: data.kind === 'company' ? companyFaq : builderFaq,
  }

  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <AppHeader />

      <main>
        {/* Hero */}
        <section className="container mx-auto px-4 py-16 text-center max-w-4xl">
          <Badge variant="secondary" className="mb-4">
            Comparison
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
            AINative Builder vs {data.displayName}: Why developers are switching
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Multi-model AI, built-in agent optimization, automatic SEO, and open-source code.
            See how AINative Builder compares to {data.displayName}.
          </p>
          <Button asChild size="lg">
            <Link href="/">Try AINative Builder Free</Link>
          </Button>
        </section>

        {/* Comparison Table */}
        <section className="container mx-auto px-4 pb-16 max-w-4xl">
          <h2 className="text-2xl font-bold mb-6 text-center">Feature Comparison</h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-6 py-4 font-semibold w-1/3">Feature</th>
                  <th className="text-center px-6 py-4 font-semibold w-1/3">
                    <span className="text-primary">AINative Builder</span>
                  </th>
                  <th className="text-center px-6 py-4 font-semibold w-1/3">
                    {data.displayName}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const competitorValue = row.competitor(data)
                  return (
                    <tr
                      key={row.feature}
                      className={`border-b last:border-0 ${i % 2 === 0 ? '' : 'bg-muted/20'}`}
                    >
                      <td className="px-6 py-4 font-medium">{row.feature}</td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={
                            row.ainativeWins
                              ? 'text-green-600 dark:text-green-400 font-medium'
                              : ''
                          }
                        >
                          {row.ainative}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center text-muted-foreground">
                        {competitorValue}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="container mx-auto px-4 pb-16 max-w-3xl">
          <h2 className="text-2xl font-bold mb-8 text-center">
            Frequently Asked Questions
          </h2>
          <div className="space-y-6">
            {(faqJsonLd.mainEntity as Array<{ '@type': string; name: string; acceptedAnswer: { '@type': string; text: string } }>).map((item) => (
              <div key={item.name} className="border rounded-lg p-6">
                <h3 className="font-semibold text-lg mb-3">{item.name}</h3>
                <p className="text-muted-foreground leading-relaxed">
                  {item.acceptedAnswer.text}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="border-t bg-muted/30">
          <div className="container mx-auto px-4 py-16 text-center max-w-2xl">
            <h2 className="text-3xl font-bold mb-4">
              Switch from {data.displayName} today
            </h2>
            <p className="text-muted-foreground mb-8">
              Start your 7-day trial on the Hobbyist plan. Build production-ready React apps
              with multi-model AI and AX optimization.
            </p>
            <Button asChild size="lg">
              <Link href="/">Try AINative Builder Free</Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  )
}
