import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AppHeader } from '@/components/shared/app-header'

// Category landing page targeting the non-branded demand Polsia is weak on:
// "AI that runs your company", "AI that builds your company", "AI co-founder".
// Fully crawlable + JSON-LD (AEO). This is the SEO/AEO half of the pivot.

export const metadata: Metadata = {
  title: 'AI That Builds AND Runs Your Company | AINative Builder',
  description:
    'The AI that builds AND runs your company. Describe an idea; Cody, your AI co-founder, composes a real running product and an operating AI-native company from real primitives (CRM, invoicing, helpdesk, voice), then runs it 24/7. You own 100%.',
  keywords: [
    'AI that runs your company', 'AI that builds your company', 'AI co-founder',
    'autonomous AI company', 'AI business builder', 'build a company with AI',
    'agent-run company', 'AI startup generator', 'AI-native company', 'Polsia alternative',
  ],
  alternates: { canonical: 'https://builder.ainative.studio/ai-company' },
  openGraph: {
    title: 'AI That Builds AND Runs Your Company',
    description: 'Describe an idea. Cody builds the product AND the company, then runs it 24/7 on real AINative primitives.',
    type: 'website',
  },
}

const STEPS = [
  ['Describe your idea', 'One sentence. Cody, your AI co-founder, takes it from there.'],
  ['Watch it get built', 'Cody composes every artifact live — brief, PRD, data model, agents, business model, landing page — from real AINative primitives.'],
  ['Get a real running product', 'A working app on a durable, shareable URL — not a mockup — plus real business systems (CRM, invoicing, helpdesk, voice).'],
  ['It runs while you sleep', 'Every night Cody evaluates the company, runs the highest-leverage task on the agent swarm, and sends you a morning summary.'],
]

const DIFFERENTIATORS = [
  ['Builds AND runs', 'Others either generate code (v0, Lovable, Bolt) or run a company you already have (Polsia). AINative does both — build the product, then operate the company.'],
  ['Real, open primitives you own', 'Every system is a real AINative product — ZeroDB, ZeroPipeline, ZeroInvoice, ServiceOS, ZeroVoice, Agent Cloud — not a closed proprietary black box.'],
  ['Agent-native + transparent', 'llms.txt, agents.txt, crawlable pages, and every artifact shows the exact primitives powering it. You watch the whole thing get built.'],
  ['Production-ready, not demos', 'Generated apps are idea-specific and deployed for real. You own 100% of everything built.'],
]

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What does "AI that runs your company" mean?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'It means an AI that operates your business autonomously — planning, building, and running day-to-day systems. AINative Builder goes further: it BUILDS the company first (a real product plus CRM, invoicing, helpdesk, and voice), then runs it 24/7 on a nightly autonomous loop.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can AI actually build a real company, not just an app?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. AINative Builder composes a real, production-ready product AND the operating company around it from real AINative primitives — a CRM (ZeroPipeline), billing (ZeroInvoice), helpdesk (ServiceOS), and voice/SMS (ZeroVoice) — each a real product you own.',
      },
    },
    {
      '@type': 'Question',
      name: 'How is this different from Polsia?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Polsia runs a company for you but you bring the product, and it is a closed, client-rendered system with no agent files. AINative Builder builds the product and the company on real open primitives you own, is fully agent-native, and lets you watch every artifact get composed live.',
      },
    },
  ],
}

export default function AICompanyPage() {
  return (
    <div className="min-h-screen bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <AppHeader />
      <main>
        <section className="container mx-auto px-4 py-16 text-center max-w-4xl">
          <Badge variant="secondary" className="mb-4">AI-native company builder</Badge>
          <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
            The AI that builds <span className="text-primary">AND</span> runs your company
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Describe an idea. Cody, your AI co-founder, composes a real running product and an
            operating AI-native company from real primitives — then runs it 24/7 while you sleep.
            You own 100%.
          </p>
          <Button asChild size="lg"><Link href="/build">Build your company free →</Link></Button>
        </section>

        <section className="container mx-auto px-4 pb-16 max-w-4xl">
          <h2 className="text-2xl font-bold mb-8 text-center">How it works</h2>
          <div className="grid gap-6 md:grid-cols-2">
            {STEPS.map(([h, d], i) => (
              <div key={h} className="border rounded-lg p-6">
                <div className="text-sm text-muted-foreground mb-2">Step {i + 1}</div>
                <h3 className="font-semibold text-lg mb-2">{h}</h3>
                <p className="text-muted-foreground leading-relaxed">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="container mx-auto px-4 pb-16 max-w-4xl">
          <h2 className="text-2xl font-bold mb-8 text-center">Why AINative wins</h2>
          <div className="grid gap-6 md:grid-cols-2">
            {DIFFERENTIATORS.map(([h, d]) => (
              <div key={h} className="border rounded-lg p-6">
                <h3 className="font-semibold text-lg mb-2">{h}</h3>
                <p className="text-muted-foreground leading-relaxed">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="container mx-auto px-4 pb-16 max-w-3xl">
          <h2 className="text-2xl font-bold mb-8 text-center">Frequently asked questions</h2>
          <div className="space-y-6">
            {faqJsonLd.mainEntity.map((item) => (
              <div key={item.name} className="border rounded-lg p-6">
                <h3 className="font-semibold text-lg mb-3">{item.name}</h3>
                <p className="text-muted-foreground leading-relaxed">{item.acceptedAnswer.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t bg-muted/30">
          <div className="container mx-auto px-4 py-16 text-center max-w-2xl">
            <h2 className="text-3xl font-bold mb-4">Stop building from scratch</h2>
            <p className="text-muted-foreground mb-8">Describe your idea. Cody builds the company and runs it — on real primitives you own.</p>
            <Button asChild size="lg"><Link href="/build">Build your company free →</Link></Button>
          </div>
        </section>
      </main>
    </div>
  )
}
