import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AppHeader } from '@/components/shared/app-header'

// Category landing page (#216) targeting non-branded, buyer-intent demand:
// "AI co-founder", "AI employee", "AI business partner". Distinct from
// /ai-company (the company) and /autonomous-company-builder (the overnight build)
// — this one leads with the PERSONA: Cody as the co-founder who builds and runs
// the company. Fully crawlable + FAQ JSON-LD (AEO). Interlinks to /ai-company,
// /autonomous-company-builder, /compare and the live /build hero.

export const metadata: Metadata = {
  title: 'AI Co-Founder — An AI Employee That Builds AND Runs Your Company | AINative',
  description:
    'Meet Cody, your AI co-founder. An AI employee that builds the product AND the operating company — CRM, billing, helpdesk, voice — from real AINative primitives, then runs it 24/7 on a nightly loop. Describe an idea; get a real running company you own 100%.',
  keywords: [
    'AI co-founder', 'AI cofounder', 'AI employee', 'AI business partner', 'AI startup co-founder',
    'AI that runs your company', 'AI agent employee', 'autonomous AI employee', 'AI co-founder for startups',
    'hire an AI co-founder',
  ],
  alternates: { canonical: 'https://builder.ainative.studio/ai-cofounder' },
  openGraph: {
    title: 'AI Co-Founder — An AI Employee That Builds AND Runs Your Company',
    description: 'Cody is the AI co-founder that builds your product and company, then runs it 24/7 on real primitives you own.',
    type: 'website',
  },
}

const STEPS = [
  ['Bring the idea', 'You describe the company in one sentence. Cody, your AI co-founder, owns the execution.'],
  ['Cody builds it', 'Your AI employee composes the product, data model, agents, business model and landing page from real AINative primitives — live, in front of you.'],
  ['Cody wires the business', 'CRM, billing, helpdesk and voice, all set up from real products — a company, not just an app.'],
  ['Cody runs it 24/7', 'Every night your co-founder evaluates the company, runs the highest-leverage task on the agent swarm, and reports back each morning.'],
]

const DIFFERENTIATORS = [
  ['A co-founder, not a copilot', 'Copilots wait for instructions. Cody takes an idea and executes end-to-end — building the product and running the company autonomously.'],
  ['An AI employee for every function', 'Cody wires real business systems — sales (ZeroPipeline), billing (ZeroInvoice), support (ServiceOS), voice/SMS (ZeroVoice) — so your company runs itself.'],
  ['Transparent and agent-native', 'Every artifact shows the exact primitives powering it. llms.txt, agents.txt and crawlable pages mean you (and other agents) can see and trust the work.'],
  ['You own the company', 'Everything Cody builds runs on real, open AINative primitives you own 100% — never a closed proprietary black box.'],
]

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is an AI co-founder?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'An AI co-founder is an AI that owns execution the way a human co-founder would — turning your idea into a real product and running the company day to day. AINative Builder gives you Cody: an AI employee that builds the product AND the operating company (CRM, billing, helpdesk, voice), then runs it 24/7 on a nightly autonomous loop.',
      },
    },
    {
      '@type': 'Question',
      name: 'How is an AI co-founder different from an AI copilot?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'A copilot assists you inside a task and waits for your next prompt. A co-founder owns the outcome. Cody takes one idea and executes end to end — composing the product, wiring the business systems, and advancing the company every night without being asked.',
      },
    },
    {
      '@type': 'Question',
      name: 'What can the AI employee actually run?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Cody wires and operates real business systems from AINative primitives: a CRM (ZeroPipeline), billing (ZeroInvoice), a helpdesk (ServiceOS), and voice/SMS (ZeroVoice). Each is a real product you own, so the company genuinely runs — it is not a simulation.',
      },
    },
    {
      '@type': 'Question',
      name: 'Do I own what my AI co-founder builds?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes — you own 100%. Everything Cody builds runs on real, open AINative primitives, fully agent-native and transparent, never locked inside a closed black box.',
      },
    },
  ],
}

export default function AICofounderPage() {
  return (
    <div className="min-h-screen bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <AppHeader />
      <main>
        <section className="container mx-auto px-4 py-16 text-center max-w-4xl">
          <Badge variant="secondary" className="mb-4">Your AI co-founder</Badge>
          <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
            An AI co-founder that <span className="text-primary">builds and runs</span> your company
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Meet Cody — the AI employee that turns your idea into a real running product and the
            company around it, then operates it 24/7 while you sleep. You own 100%.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg"><Link href="/build">Start with your AI co-founder →</Link></Button>
            <Button asChild size="lg" variant="outline"><Link href="/autonomous-company-builder">Build a SaaS overnight →</Link></Button>
          </div>
        </section>

        <section className="container mx-auto px-4 pb-16 max-w-4xl">
          <h2 className="text-2xl font-bold mb-8 text-center">How Cody works</h2>
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
          <h2 className="text-2xl font-bold mb-8 text-center">Why Cody wins</h2>
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
            See how an AI co-founder compares to code generators and company-runners.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Button asChild variant="outline"><Link href="/compare/polsia">vs Polsia</Link></Button>
            <Button asChild variant="outline"><Link href="/compare/v0">vs v0</Link></Button>
            <Button asChild variant="outline"><Link href="/compare/lovable">vs Lovable</Link></Button>
            <Button asChild variant="outline"><Link href="/ai-company">The AI-native company →</Link></Button>
          </div>
        </section>

        <section className="border-t bg-muted/30">
          <div className="container mx-auto px-4 py-16 text-center max-w-2xl">
            <h2 className="text-3xl font-bold mb-4">Hire your AI co-founder</h2>
            <p className="text-muted-foreground mb-8">Describe your idea. Cody builds the company and runs it — on real primitives you own.</p>
            <Button asChild size="lg"><Link href="/build">Start free →</Link></Button>
          </div>
        </section>
      </main>
    </div>
  )
}
