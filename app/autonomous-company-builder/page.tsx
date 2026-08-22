import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AppHeader } from '@/components/shared/app-header'

// Category landing page (#216) targeting non-branded, buyer-intent demand that
// Polsia does NOT rank for: "autonomous company builder", "build a SaaS with AI
// overnight", "autonomous AI startup builder". Fully crawlable + FAQ JSON-LD (AEO).
// Interlinks to /ai-company, /compare and the live /build hero for conversion.

export const metadata: Metadata = {
  title: 'Autonomous Company Builder — Build a SaaS With AI Overnight | AINative',
  description:
    'An autonomous company builder that turns one idea into a real running SaaS overnight. Cody composes the product AND the operating company — CRM, billing, helpdesk, voice — from real AINative primitives, then runs it 24/7 on a nightly agent loop. You own 100%.',
  keywords: [
    'autonomous company builder', 'build a SaaS with AI overnight', 'autonomous AI startup builder',
    'AI startup generator', 'build a startup with AI', 'AI SaaS builder', 'autonomous business builder',
    'AI that builds a company overnight', 'agent-run company', 'autonomous AI company',
  ],
  alternates: { canonical: 'https://builder.ainative.studio/autonomous-company-builder' },
  openGraph: {
    title: 'Autonomous Company Builder — Build a SaaS With AI Overnight',
    description: 'One idea in, a real running SaaS out. Cody builds the product and the company, then runs it 24/7 on real primitives you own.',
    type: 'website',
  },
}

const STEPS = [
  ['Describe the SaaS', 'One sentence tonight. Cody, your autonomous co-founder, takes it from there.'],
  ['It builds overnight', 'Cody composes every artifact — data model, agents, business model, landing page, and a real deployed app — from real AINative primitives while you sleep.'],
  ['Wake up to a running company', 'A working SaaS on a durable, shareable URL, wired to CRM, billing, helpdesk and voice — not a prototype.'],
  ['It keeps running itself', 'Every night the autonomous loop evaluates the company, runs the highest-leverage task on the agent swarm, and sends you a morning summary.'],
]

const DIFFERENTIATORS = [
  ['Autonomous, not assistive', 'Most "AI builders" wait for your next prompt. AINative runs a nightly loop that advances the company on its own — build once, then let it operate.'],
  ['A whole SaaS, not a screen', 'v0, Lovable and Bolt stop at a generated UI. AINative ships a real product plus the business systems to run it — CRM (ZeroPipeline), billing (ZeroInvoice), helpdesk (ServiceOS), voice/SMS (ZeroVoice).'],
  ['Real primitives you own', 'Every system is a real, open AINative product — not a closed proprietary black box. You own 100% of everything built.'],
  ['Overnight, for real', 'Idea-specific, production-ready, and deployed — you can share the URL the next morning, not a demo that disappears.'],
]

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is an autonomous company builder?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'An autonomous company builder turns an idea into a real running business without you writing code or wiring tools. AINative Builder composes the product AND the operating company — CRM, billing, helpdesk, and voice — from real primitives, then runs it 24/7 on a nightly autonomous loop instead of waiting for your next prompt.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I really build a SaaS with AI overnight?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. Describe the SaaS in one sentence and Cody composes a production-ready, idea-specific app on a durable, shareable URL, wired to real business systems. It is deployed for real — not a mockup — so you can share it the next morning.',
      },
    },
    {
      '@type': 'Question',
      name: 'How is this different from v0, Lovable, or Bolt?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Those tools generate a UI and stop. AINative goes further: it builds a real product plus the operating company around it (CRM, billing, helpdesk, voice) and then runs the whole thing autonomously every night. Everything is built on open primitives you own.',
      },
    },
    {
      '@type': 'Question',
      name: 'Do I own what gets built?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes — you own 100%. Every system is a real AINative primitive (ZeroDB, ZeroPipeline, ZeroInvoice, ServiceOS, ZeroVoice, Agent Cloud), fully agent-native and transparent, never a closed black box.',
      },
    },
  ],
}

export default function AutonomousCompanyBuilderPage() {
  return (
    <div className="min-h-screen bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <AppHeader />
      <main>
        <section className="container mx-auto px-4 py-16 text-center max-w-4xl">
          <Badge variant="secondary" className="mb-4">Autonomous company builder</Badge>
          <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
            Build a SaaS with AI <span className="text-primary">overnight</span>
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            An autonomous company builder that turns one idea into a real running SaaS — the product
            AND the company around it — then runs it 24/7 while you sleep. You own 100%.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg"><Link href="/build">Build your SaaS free →</Link></Button>
            <Button asChild size="lg" variant="outline"><Link href="/ai-company">See the AI-native company →</Link></Button>
          </div>
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

        <section className="container mx-auto px-4 pb-16 max-w-3xl text-center">
          <h2 className="text-2xl font-bold mb-4">Compare the alternatives</h2>
          <p className="text-muted-foreground mb-6">
            See how an autonomous company builder stacks up against code generators and company-runners.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Button asChild variant="outline"><Link href="/compare/polsia">vs Polsia</Link></Button>
            <Button asChild variant="outline"><Link href="/compare/v0">vs v0</Link></Button>
            <Button asChild variant="outline"><Link href="/compare/lovable">vs Lovable</Link></Button>
            <Button asChild variant="outline"><Link href="/compare/bolt">vs Bolt</Link></Button>
          </div>
        </section>

        <section className="border-t bg-muted/30">
          <div className="container mx-auto px-4 py-16 text-center max-w-2xl">
            <h2 className="text-3xl font-bold mb-4">Start it tonight</h2>
            <p className="text-muted-foreground mb-8">Describe your SaaS. Cody builds it overnight and runs it — on real primitives you own.</p>
            <Button asChild size="lg"><Link href="/build">Build your SaaS free →</Link></Button>
          </div>
        </section>
      </main>
    </div>
  )
}
