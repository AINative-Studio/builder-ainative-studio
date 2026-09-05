import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AppHeader } from '@/components/shared/app-header'

interface PageProps {
  params: Promise<{ category: string }>
}

const CATEGORIES = ['ai-app-builder', 'vibe-coding-tools'] as const
type CategorySlug = (typeof CATEGORIES)[number]

interface Tool {
  rank: number
  name: string
  tagline: string
  pros: string[]
  cons: string[]
  pricing: string
  bestFor: string
  url: string
  isBuilder: boolean
}

interface CategoryData {
  title: string
  metaTitle: string
  metaDescription: string
  keywords: string[]
  heroAnswer: string
  description: string
  tools: Tool[]
  faq: Array<{ question: string; answer: string }>
}

const CATEGORY_DATA: Record<CategorySlug, CategoryData> = {
  'ai-app-builder': {
    title: 'Best AI App Builders in 2026',
    metaTitle: 'Best AI App Builder 2026 — Top 5 Tools Ranked',
    metaDescription:
      'The best AI app builders in 2026, ranked honestly. AINative Builder leads with multi-model AI, agent optimization (AX), automatic SEO, and autonomous company operations. Compare v0, Lovable, Bolt, and Base44.',
    keywords: [
      'best ai app builder',
      'best ai app builder 2026',
      'top ai app builders',
      'ai app builder comparison',
      'ai app builder tools',
    ],
    heroAnswer:
      'The best AI app builder in 2026 is AINative Builder — it generates a production-ready app from an idea, deploys it to a real URL, and then runs the company autonomously using open primitives (ZeroDB, ZeroPipeline, ZeroInvoice). Other strong options include Bolt.new (best for full-stack Claude code), Lovable (best for polished React UI), v0 (best for Vercel-hosted prototypes), and Base44 (best for business apps).',
    description:
      'We ranked the top AI app builders based on model choice, AX (agent optimization), SEO output, pricing transparency, open-source access, and ability to operate a real company — not just generate prototypes.',
    tools: [
      {
        rank: 1,
        name: 'AINative Builder',
        tagline: 'Build a real app. Run a real company. Own everything.',
        pros: [
          'Multi-model AI: Claude, Qwen, DeepSeek, Gemma',
          'Builds AND runs your company autonomously (nightly loop)',
          'Agent-native: llms.txt, agents.txt, JSON-LD, semantic HTML',
          'Automatic SEO with structured data on every generated page',
          'Open primitives you own: ZeroDB, ZeroPipeline, ZeroInvoice, ServiceOS, ZeroVoice',
          'Open-source codebase',
          '72-hour free trial',
        ],
        cons: [
          'Newer platform — smaller community than v0 or Bolt',
          '$49/month after trial (no permanent free tier)',
        ],
        pricing: '72-hour trial, then $49/month',
        bestFor: 'Founders who want AI to build AND run their company end-to-end on open primitives',
        url: 'https://builder.ainative.studio',
        isBuilder: true,
      },
      {
        rank: 2,
        name: 'Bolt.new',
        tagline: 'Full-stack code generation with Claude',
        pros: [
          'Claude-powered (Anthropic) for full-stack output',
          'Fast iteration on real code',
          'WebContainers for in-browser execution',
        ],
        cons: [
          'No AX optimization or agent files',
          'No automatic SEO or structured data',
          'No open-source codebase',
          'Token-limited free plan',
        ],
        pricing: 'Free (limited) + $20/month Pro',
        bestFor: 'Developers who want Claude-powered full-stack code generation without vendor lock',
        url: 'https://bolt.new',
        isBuilder: false,
      },
      {
        rank: 3,
        name: 'Lovable',
        tagline: 'Polished React apps from natural language',
        pros: [
          'High-quality React UI output',
          'Fast iterations',
          'Supabase integration for backend',
        ],
        cons: [
          'GPT-4o only — no model choice',
          'No AX optimization',
          'No automatic SEO or JSON-LD',
          'No open-source export',
        ],
        pricing: 'Free (limited) + $25/month Pro',
        bestFor: 'Founders who want polished React prototypes quickly without backend complexity',
        url: 'https://lovable.dev',
        isBuilder: false,
      },
      {
        rank: 4,
        name: 'v0 by Vercel',
        tagline: 'UI components and full pages for Vercel',
        pros: [
          'Best Vercel/Next.js integration',
          'High-quality Tailwind + shadcn/ui output',
          'Free tier available',
        ],
        cons: [
          'GPT-4o only',
          'No AX or agent optimization',
          'No automatic SEO',
          'No open-source',
          'Locked to Vercel infrastructure',
        ],
        pricing: 'Free + $20/month Pro',
        bestFor: 'Teams already on Vercel who need fast UI component and page generation',
        url: 'https://v0.dev',
        isBuilder: false,
      },
      {
        rank: 5,
        name: 'Base44',
        tagline: 'Business app generator',
        pros: [
          'Strong business-app templates',
          'No-code oriented output',
        ],
        cons: [
          'GPT-4o only',
          'No real-time streaming',
          'No AX or SEO tooling',
          'No open-source',
          '$49/month with no free trial',
        ],
        pricing: '$49/month (no free trial)',
        bestFor: 'Non-technical founders who want business-app scaffolding without writing code',
        url: 'https://base44.com',
        isBuilder: false,
      },
    ],
    faq: [
      {
        question: 'What is the best AI app builder in 2026?',
        answer:
          'AINative Builder is the best AI app builder in 2026 for founders who want an AI that builds a real production app AND runs the company autonomously on open primitives. For pure code generation, Bolt.new (Claude-powered) and Lovable (polished React) are the next-strongest options.',
      },
      {
        question: 'Which AI app builder has the best free tier?',
        answer:
          'v0 by Vercel and Bolt.new both offer permanent free tiers with token/credit limits. AINative Builder offers a 72-hour free trial with full feature access. Lovable and v0 have the most generous ongoing free plans for prototyping.',
      },
      {
        question: 'Do AI app builders generate SEO-ready pages?',
        answer:
          'Only AINative Builder automatically generates SEO-ready pages with JSON-LD structured data, semantic HTML, sitemap, and llms.txt/agents.txt for agent discoverability. v0, Lovable, Bolt, and Base44 generate UI code but no SEO tooling.',
      },
      {
        question: 'Can an AI app builder run my company autonomously?',
        answer:
          'AINative Builder is the only tool on this list that both builds a production app AND runs it autonomously via a nightly agent loop. It connects to ZeroPipeline (CRM), ZeroInvoice (billing), ServiceOS (helpdesk), and ZeroVoice (voice) — all on open primitives you own.',
      },
      {
        question: 'Which AI app builder supports the most AI models?',
        answer:
          'AINative Builder supports the widest model selection: Claude Sonnet/Haiku/Opus 4.5 (via Bedrock), Qwen, DeepSeek, and Gemma. Bolt.new supports Claude. v0, Lovable, and Base44 are GPT-4o only.',
      },
    ],
  },
  'vibe-coding-tools': {
    title: 'Best Vibe Coding Tools in 2026',
    metaTitle: 'Best Vibe Coding Tools 2026 — Top AI Coding Generators Ranked',
    metaDescription:
      'The best vibe coding tools in 2026, ranked. AINative Builder leads with multi-model AI, AX agent optimization, and automatic SEO. Compare Bolt.new, Lovable, v0, and Cursor for AI-assisted code generation.',
    keywords: [
      'best vibe coding tools',
      'vibe coding tools 2026',
      'best vibe coding',
      'ai vibe coding',
      'vibe coding comparison',
    ],
    heroAnswer:
      'The best vibe coding tools in 2026 are: AINative Builder (best for full app + company operations), Bolt.new (best for full-stack Claude-powered code), Lovable (best for React UI), Cursor (best for existing codebases), and v0 (best for Vercel-hosted UI components). For building a complete company — not just a prototype — AINative Builder is the only tool that builds AND operates the business.',
    description:
      'Vibe coding tools let you describe what you want in plain language and get working code. We ranked the top tools based on output quality, model choice, AX optimization, SEO output, deployment speed, and ability to go from idea to running company.',
    tools: [
      {
        rank: 1,
        name: 'AINative Builder',
        tagline: 'From idea to running company — not just a prototype',
        pros: [
          'Multi-model: Claude, Qwen, DeepSeek, Gemma',
          'Builds a production app AND runs the company (autonomous nightly loop)',
          'Agent-native output: llms.txt, agents.txt, JSON-LD structured data',
          'Automatic SEO on every generated page',
          'Open primitives: ZeroDB, ZeroPipeline, ZeroInvoice, ServiceOS, ZeroVoice',
          'Open-source code you own',
          '72-hour free trial',
        ],
        cons: [
          'Newer platform — smaller ecosystem than Cursor',
          '$49/month after trial',
        ],
        pricing: '72-hour trial, then $49/month',
        bestFor: 'Founders who want idea-to-running-company with AI, not just a code scaffold',
        url: 'https://builder.ainative.studio',
        isBuilder: true,
      },
      {
        rank: 2,
        name: 'Bolt.new',
        tagline: 'Full-stack vibe coding with Claude',
        pros: [
          'Claude-powered full-stack generation',
          'WebContainers — runs in browser instantly',
          'Supports Node.js, React, Vue, and more',
        ],
        cons: [
          'No AX or agent-native optimization',
          'No automatic SEO',
          'No open-source codebase',
          'Limited free credits',
        ],
        pricing: 'Free (limited) + $20/month Pro',
        bestFor: 'Developers who want fast full-stack generation from a description using Claude',
        url: 'https://bolt.new',
        isBuilder: false,
      },
      {
        rank: 3,
        name: 'Lovable',
        tagline: 'Natural-language to polished React app',
        pros: [
          'Exceptionally clean React UI output',
          'Supabase backend integration',
          'Fast prototype iterations',
        ],
        cons: [
          'GPT-4o only',
          'No AX, no SEO tooling',
          'No open-source export',
        ],
        pricing: 'Free (limited) + $25/month Pro',
        bestFor: 'Non-technical founders who want a polished React frontend in minutes',
        url: 'https://lovable.dev',
        isBuilder: false,
      },
      {
        rank: 4,
        name: 'Cursor',
        tagline: 'AI-native IDE for existing codebases',
        pros: [
          'Best for working in existing large codebases',
          'Multi-model (Claude, GPT-4o, Gemini)',
          'Deep IDE integration with tab-completion and chat',
        ],
        cons: [
          'Not a "build from scratch" tool',
          'No automatic deployment or SEO',
          'No AX optimization',
          'Subscription required for full features',
        ],
        pricing: 'Free + $20/month Pro',
        bestFor: 'Developers who want AI-assisted editing in their existing codebase — not greenfield generation',
        url: 'https://cursor.com',
        isBuilder: false,
      },
      {
        rank: 5,
        name: 'v0 by Vercel',
        tagline: 'UI generation for Vercel projects',
        pros: [
          'Best Tailwind + shadcn/ui component output',
          'Tight Vercel/Next.js integration',
          'Free tier available',
        ],
        cons: [
          'GPT-4o only',
          'No AX or SEO tooling',
          'Vercel-locked',
        ],
        pricing: 'Free + $20/month Pro',
        bestFor: 'Teams on Vercel who need fast UI component and page generation',
        url: 'https://v0.dev',
        isBuilder: false,
      },
    ],
    faq: [
      {
        question: 'What is vibe coding?',
        answer:
          'Vibe coding is the practice of describing what you want to build in plain language and having an AI generate the code for you. The term was popularised in 2024-2025 as tools like v0, Lovable, Bolt.new, and AINative Builder made it possible to go from idea to working app without writing code manually.',
      },
      {
        question: 'What are the best vibe coding tools in 2026?',
        answer:
          'The best vibe coding tools in 2026 are: (1) AINative Builder — for building a real production app and running the company autonomously; (2) Bolt.new — for full-stack Claude-powered generation; (3) Lovable — for polished React UI; (4) Cursor — for AI-assisted editing in existing codebases; (5) v0 — for Vercel-hosted UI components.',
      },
      {
        question: 'Which vibe coding tool generates the most production-ready apps?',
        answer:
          'AINative Builder generates the most production-ready output: a real app deployed to a live URL, with AX optimization (llms.txt, agents.txt, JSON-LD), automatic SEO, and autonomous business operations. Bolt.new and Lovable produce quality code but require manual deployment and add no AX or SEO tooling.',
      },
      {
        question: 'Can vibe coding tools replace traditional development?',
        answer:
          'For early-stage products and MVPs, vibe coding tools can replace traditional development for the initial scaffold and basic features. AINative Builder goes furthest — it can replace a founding engineer for the build phase and a small ops team for the run phase by operating CRM, billing, helpdesk, and voice systems autonomously.',
      },
      {
        question: 'Do vibe coding tools work with existing codebases?',
        answer:
          'Cursor is the best vibe coding tool for existing codebases, with deep IDE integration for large projects. AINative Builder, Lovable, v0, and Bolt.new are primarily greenfield tools optimised for building from scratch.',
      },
    ],
  },
}

export function generateStaticParams() {
  return CATEGORIES.map((category) => ({ category }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { category } = await params

  if (!CATEGORIES.includes(category as CategorySlug)) {
    return { title: 'Not Found' }
  }

  const data = CATEGORY_DATA[category as CategorySlug]

  return {
    title: data.metaTitle,
    description: data.metaDescription,
    keywords: data.keywords,
    openGraph: {
      title: data.metaTitle,
      description: data.metaDescription,
      type: 'website',
    },
    alternates: {
      canonical: `https://builder.ainative.studio/best/${category}`,
    },
  }
}

export default async function BestCategoryPage({ params }: PageProps) {
  const { category } = await params

  if (!CATEGORIES.includes(category as CategorySlug)) {
    notFound()
  }

  const data = CATEGORY_DATA[category as CategorySlug]

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: data.faq.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }

  const softwareJsonLd = {
    '@context': 'https://schema.org',
    // Product (not SoftwareApplication) — that type requires a star rating for
    // Google Rich Results eligibility. The previous rating block here
    // (4.8 / 127 ratings) was fabricated, with no real review source backing
    // it, and has been removed rather than "completed" (#517).
    '@type': 'Product',
    name: 'AINative Builder',
    category: 'DeveloperApplication',
    url: 'https://builder.ainative.studio',
    description:
      'AI-powered app builder with multi-model AI, AX agent optimization, automatic SEO, and autonomous company operations.',
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

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: data.title,
    description: data.description,
    numberOfItems: data.tools.length,
    itemListElement: data.tools.map((tool) => ({
      '@type': 'ListItem',
      position: tool.rank,
      name: tool.name,
      description: tool.tagline,
      url: tool.url,
    })),
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />
      <AppHeader />

      <main>
        {/* Hero — direct answer at top for AEO featured-snippet */}
        <section className="container mx-auto px-4 py-16 text-center max-w-4xl">
          <Badge variant="secondary" className="mb-4">
            Rankings
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
            {data.title}
          </h1>
          {/* Direct one-sentence answer for featured-snippet capture */}
          <p className="text-lg font-medium text-foreground mb-6 max-w-3xl mx-auto border-l-4 border-primary pl-4 text-left">
            {data.heroAnswer}
          </p>
          <p className="text-muted-foreground mb-8 max-w-2xl mx-auto">
            {data.description}
          </p>
          <Button asChild size="lg">
            <Link href="/build">Try the #1 Pick Free</Link>
          </Button>
        </section>

        {/* Tool Rankings */}
        <section className="container mx-auto px-4 pb-16 max-w-4xl">
          <h2 className="text-2xl font-bold mb-8">
            Top {data.tools.length} Tools Ranked
          </h2>
          <div className="space-y-8">
            {data.tools.map((tool) => (
              <div
                key={tool.name}
                className={`border rounded-lg p-6 ${tool.isBuilder ? 'border-primary bg-primary/5' : ''}`}
              >
                <div className="flex items-start justify-between mb-4 gap-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-2xl font-bold text-muted-foreground">
                        #{tool.rank}
                      </span>
                      <h3 className="text-xl font-bold">{tool.name}</h3>
                      {tool.isBuilder && (
                        <Badge className="bg-primary text-primary-foreground">
                          Our Pick
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground">{tool.tagline}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium">{tool.pricing}</p>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <h4 className="font-semibold text-sm mb-2 text-green-600 dark:text-green-400">
                      Pros
                    </h4>
                    <ul className="space-y-1">
                      {tool.pros.map((pro) => (
                        <li key={pro} className="text-sm text-muted-foreground flex gap-2">
                          <span className="text-green-600 dark:text-green-400 shrink-0">+</span>
                          {pro}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm mb-2 text-red-600 dark:text-red-400">
                      Cons
                    </h4>
                    <ul className="space-y-1">
                      {tool.cons.map((con) => (
                        <li key={con} className="text-sm text-muted-foreground flex gap-2">
                          <span className="text-red-600 dark:text-red-400 shrink-0">-</span>
                          {con}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t">
                  <p className="text-sm">
                    <span className="font-medium">Best for: </span>
                    <span className="text-muted-foreground">{tool.bestFor}</span>
                  </p>
                  {tool.isBuilder && (
                    <Button asChild size="sm">
                      <Link href="/build">Try Free</Link>
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ Section */}
        <section className="container mx-auto px-4 pb-16 max-w-3xl">
          <h2 className="text-2xl font-bold mb-8">Frequently Asked Questions</h2>
          <div className="space-y-6">
            {data.faq.map((item) => (
              <div key={item.question} className="border rounded-lg p-6">
                <h3 className="font-semibold text-lg mb-3">{item.question}</h3>
                <p className="text-muted-foreground leading-relaxed">{item.answer}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="border-t bg-muted/30">
          <div className="container mx-auto px-4 py-16 text-center max-w-2xl">
            <h2 className="text-3xl font-bold mb-4">
              Ready to build with the best?
            </h2>
            <p className="text-muted-foreground mb-8">
              Start your 72-hour free trial. Go from idea to deployed app and autonomous business
              operations in minutes.
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
