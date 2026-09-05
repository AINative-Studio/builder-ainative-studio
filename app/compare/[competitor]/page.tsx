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
  // Answer-shaped hero copy for AEO — direct one-sentence answer to the buyer query
  heroAnswer: string
  // Pricing detail for FAQ
  pricingDetail: string
  // Review / reputation context for FAQ
  reviewContext: string
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
    heroAnswer:
      'AINative Builder is the best v0 alternative for teams who need multi-model AI (Claude, Qwen, DeepSeek), built-in agent optimization (AX), automatic JSON-LD SEO, and open-source code — none of which v0 provides.',
    pricingDetail:
      'v0 offers a free tier with limited credits and a $20/month Pro plan. AINative Builder offers a 72-hour trial, then $49/month, which includes multi-model AI, AX scoring, SEO automation, and open-source code export.',
    reviewContext:
      'v0 is well-reviewed for quickly generating Vercel-hosted UI prototypes, but users consistently report it is locked to GPT-4o and Vercel infrastructure with no AX or SEO tooling.',
  },
  lovable: {
    displayName: 'Lovable',
    models: 'GPT-4o only',
    ax: 'No',
    seo: 'None',
    pricing: 'Free + $25/mo',
    opensource: 'No',
    streaming: 'Yes',
    heroAnswer:
      'AINative Builder is the best Lovable alternative for founders who want multi-model AI, agent-optimized output, automatic SEO, and code they actually own — Lovable locks you into GPT-4o with no AX or structured-data tooling.',
    pricingDetail:
      'Lovable costs $25/month on the Pro plan, with a limited free tier. AINative Builder starts with a 72-hour trial, then $49/month, covering multi-model AI selection, AX optimization, SEO JSON-LD, and open-source export.',
    reviewContext:
      'Lovable is praised for its polish and speed of prototyping React apps, but reviews note it is GPT-4o-only, output is not AX-optimized, and there is no structured-data or SEO tooling built in.',
  },
  bolt: {
    displayName: 'Bolt.new',
    models: 'Claude + limited',
    ax: 'No',
    seo: 'None',
    pricing: 'Free + $20/mo',
    opensource: 'No',
    streaming: 'Yes',
    heroAnswer:
      'AINative Builder is the best Bolt.new alternative if you need AX/agent optimization, automatic SEO with JSON-LD, open-source code, and a broader model choice — Bolt supports Claude but adds no agent-native or SEO tooling.',
    pricingDetail:
      'Bolt.new offers a free plan with token limits and a $20/month Pro plan. AINative Builder offers a 72-hour trial, then $49/month, with multi-model AI, AX scoring, SEO automation, and exportable open-source code.',
    reviewContext:
      'Bolt.new is well-regarded for full-stack code generation with Claude, but reviewers note it has no AX scoring, no structured-data SEO output, and no open-source codebase.',
  },
  base44: {
    displayName: 'Base44',
    models: 'GPT-4o only',
    ax: 'No',
    seo: 'None',
    pricing: '$49/mo',
    opensource: 'No',
    streaming: 'No',
    heroAnswer:
      'AINative Builder is the best Base44 alternative: same $49/month price point, but with multi-model AI, real-time streaming, AX optimization, automatic SEO, and open-source code — Base44 has none of those.',
    pricingDetail:
      'Base44 costs $49/month with no free trial and no real-time streaming. AINative Builder is also $49/month but includes a 72-hour trial, real-time streaming, multi-model AI, AX optimization, and SEO-ready output.',
    reviewContext:
      'Base44 is valued for business-app generation, but at $49/month users expect streaming and open-source output — both missing. Reviews flag the GPT-4o lock-in and lack of agent or SEO tooling as key weaknesses.',
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
    heroAnswer:
      'AINative Builder is the best Polsia alternative: Builder first BUILDS a real, production app on primitives you own, then runs it autonomously — Polsia only operates a closed CSR black box that you cannot inspect, extend, or own.',
    pricingDetail:
      'Polsia pricing is subscription-based and not publicly listed. AINative Builder starts with a 72-hour trial, then $49/month — you get a built app, autonomous operations, and full access to the underlying open primitives (ZeroDB, ZeroPipeline, ZeroInvoice, ServiceOS, ZeroVoice).',
    reviewContext:
      'Polsia ($12.56M ARR) is recognised for autonomous company operations, but reviews note it is a client-rendered black box with no agent files, no llms.txt, and no way to inspect or extend the underlying system. Users do not own primitives.',
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

  const isPolsia = competitor === 'polsia'
  const title = isPolsia
    ? `AINative Builder vs Polsia — Best Polsia Alternative 2026`
    : `AINative Builder vs ${data.displayName} - Best Alternative 2026`
  const description = isPolsia
    ? `Is Polsia legit? See Polsia pricing, reviews, and why AINative Builder is the best Polsia alternative. Builder builds a real app first, then runs it autonomously on primitives you own.`
    : `Compare AINative Builder vs ${data.displayName}. AINative offers multi-model AI (Claude, Qwen, Gemma, DeepSeek), built-in AX optimization, automatic SEO, and open-source code — features ${data.displayName} doesn't provide.`

  const keywords = isPolsia
    ? [
        'polsia alternative',
        'is polsia legit',
        'polsia pricing',
        'polsia cost',
        'polsia ai reviews',
        'polsia competitor',
        'AINative vs Polsia',
        'best polsia alternative 2026',
      ]
    : [
        `${competitor} alternative`,
        `${data.displayName} alternative`,
        `is ${competitor} worth it`,
        `${competitor} pricing`,
        `${competitor} reviews`,
        `AINative vs ${data.displayName}`,
        'best AI app builder 2026',
        'AI UI generator alternative',
      ]

  return {
    title,
    description,
    keywords,
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
      name: `Is Polsia legit?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `Yes, Polsia is a real company with reported $12.56M ARR and ~19,900 paying customers. It provides autonomous AI agents that operate business workflows. However, Polsia is a closed, client-rendered black box: no llms.txt, no agents.txt, no way to inspect or own the underlying system. If you need AI that both BUILDS your product and RUNS it on open primitives you own, AINative Builder is the stronger choice.`,
      },
    },
    {
      '@type': 'Question',
      name: `What is Polsia pricing / how much does Polsia cost?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `Polsia's pricing is subscription-based but not publicly listed on their website. AINative Builder costs $49/month (72-hour trial available) and covers building a real production app plus autonomous company operations — ZeroDB, ZeroPipeline, ZeroInvoice, ServiceOS, and ZeroVoice — all on primitives you own and can inspect.`,
      },
    },
    {
      '@type': 'Question',
      name: `What do Polsia AI reviews say?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `Polsia is recognised for running autonomous company operations, but reviews consistently note it is a client-rendered SPA with no agent files (no llms.txt/agents.txt/robots.txt), making it invisible to LLMs and crawlers. Users do not own the underlying primitives and cannot extend or audit the system. AINative Builder is agent-native from the start: SSR pages, llms.txt, agents.txt, and JSON-LD structured data.`,
      },
    },
    {
      '@type': 'Question',
      name: `What is the best Polsia alternative?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `AINative Builder is the best Polsia alternative for founders who want AI that both builds AND runs their company. Builder generates a real, idea-specific production app on a shareable URL first, then operates it nightly via autonomous agents — using ZeroDB, ZeroPipeline, ZeroInvoice, ServiceOS, and ZeroVoice. Unlike Polsia's closed CSR black box, every artifact is visible, owned by you, and built on open primitives.`,
      },
    },
    {
      '@type': 'Question',
      name: `What is the difference between AINative Builder and Polsia?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `Polsia runs your company autonomously, but you have to bring the product. AINative Builder BUILDS the company first — a real, production-ready app on a shareable URL plus business systems (CRM via ZeroPipeline, billing via ZeroInvoice, helpdesk via ServiceOS, voice via ZeroVoice) — and THEN runs it on a nightly autonomous loop. You watch every artifact get composed live and you own 100% of what is built.`,
      },
    },
  ]

  const builderFaq = [
    {
      '@type': 'Question',
      name: `Is ${data.displayName} worth it?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `${data.displayName} is worth it for rapid UI prototyping, but it is limited to ${data.models} with no AX optimization, no automatic SEO with structured data, and no open-source code export. If you need multi-model flexibility, agent-optimized output, and crawlable SEO-ready pages, AINative Builder is a better value at $49/month.`,
      },
    },
    {
      '@type': 'Question',
      name: `What is ${data.displayName} pricing?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `${data.pricingDetail}`,
      },
    },
    {
      '@type': 'Question',
      name: `What do ${data.displayName} reviews say?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `${data.reviewContext} AINative Builder addresses all these gaps: multi-model AI, AX scoring for agent accessibility, automatic JSON-LD structured data, and open-source codebase.`,
      },
    },
    {
      '@type': 'Question',
      name: `What is the best ${data.displayName} alternative?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `AINative Builder is the best ${data.displayName} alternative for developers who need multi-model flexibility (Claude, Qwen, DeepSeek, Gemma), agent-optimized output (AX scoring), automatic SEO with JSON-LD structured data, and open-source code. It starts with a 72-hour trial, then $49/month.`,
      },
    },
    {
      '@type': 'Question',
      name: `What is the difference between AINative Builder and ${data.displayName}?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `AINative Builder supports multiple AI models including Claude, Qwen, Gemma, and DeepSeek, while ${data.displayName} uses ${data.models}. AINative also includes built-in AX (Agent Experience) optimization and automatic SEO with structured data — features not available in ${data.displayName}.`,
      },
    },
  ]

  const faqItems = data.kind === 'company' ? companyFaq : builderFaq

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems,
  }

  const softwareJsonLd = {
    '@context': 'https://schema.org',
    // Product (not SoftwareApplication) — that type requires a star rating for
    // Google Rich Results eligibility, and we never fabricate one (#517).
    '@type': 'Product',
    name: 'AINative Builder',
    category: 'DeveloperApplication',
    url: 'https://builder.ainative.studio',
    description:
      'AI-powered app builder with multi-model AI, AX optimization, automatic SEO, and open-source code. Build and run a real company from an idea.',
    offers: {
      '@type': 'Offer',
      price: '49',
      priceCurrency: 'USD',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: '49',
        priceCurrency: 'USD',
        unitText: 'MONTH',
      },
    },
  }

  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
      />
      <AppHeader />

      <main>
        {/* Hero — answer-shaped, direct answer at the top for AEO */}
        <section className="container mx-auto px-4 py-16 text-center max-w-4xl">
          <Badge variant="secondary" className="mb-4">
            Comparison
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
            AINative Builder vs {data.displayName}
          </h1>
          {/* Direct answer — one sentence, above the fold, for featured-snippet capture */}
          <p className="text-lg font-medium text-foreground mb-4 max-w-3xl mx-auto border-l-4 border-primary pl-4 text-left">
            {data.heroAnswer}
          </p>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Multi-model AI, built-in agent optimization, automatic SEO, and open-source code.
            See how AINative Builder compares to {data.displayName}.
          </p>
          <Button asChild size="lg">
            <Link href="/build">Try AINative Builder Free</Link>
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

        {/* FAQ Section — structured for FAQPage JSON-LD and featured-snippet capture */}
        <section className="container mx-auto px-4 pb-16 max-w-3xl">
          <h2 className="text-2xl font-bold mb-8 text-center">
            Frequently Asked Questions
          </h2>
          <div className="space-y-6">
            {(faqItems as Array<{ '@type': string; name: string; acceptedAnswer: { '@type': string; text: string } }>).map((item) => (
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
              Start your 72-hour trial. Build a production-ready app and business system
              from a single idea — with multi-model AI and AX optimization.
            </p>
            <Button asChild size="lg">
              <Link href="/build">Start Building Free</Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  )
}
