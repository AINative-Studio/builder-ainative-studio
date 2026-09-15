import type { Metadata } from 'next'
import Link from 'next/link'
import { PublicNav } from '@/components/shared/public-nav'
import { PublicFooter } from '@/components/shared/public-footer'

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
    <div className="modernist" style={{ minHeight: '100vh' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <PublicNav />
      <main>
        <section style={{ maxWidth: 900, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
          <p className="m-eyebrow" style={{ marginBottom: 16 }}>AI-native company builder</p>
          <h1 className="m-h1" style={{ margin: '0 auto 20px' }}>
            The AI that builds <span style={{ color: 'var(--color-accent)' }}>AND</span> runs your company
          </h1>
          <p style={{ fontSize: 19, color: 'var(--text-muted)', marginBottom: 32, maxWidth: 640, marginInline: 'auto' }}>
            Describe an idea. Cody, your AI co-founder, composes a real running product and an
            operating AI-native company from real primitives — then runs it 24/7 while you sleep.
            You own 100%.
          </p>
          <Link href="/build" className="btn-primary" style={{ textDecoration: 'none' }}>Build your company free →</Link>
        </section>

        <section style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px 64px' }}>
          <h2 className="m-h1" style={{ fontSize: 28, textAlign: 'center', margin: '0 auto 32px' }}>How it works</h2>
          <div style={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', background: 'var(--color-divider)' }}>
            {STEPS.map(([h, d], i) => (
              <div key={h} style={{ background: 'var(--color-bg)', padding: 24, borderTop: '4px solid var(--color-divider)' }}>
                <div className="m-mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.08em' }}>Step {i + 1}</div>
                <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>{h}</h3>
                <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px 64px' }}>
          <h2 className="m-h1" style={{ fontSize: 28, textAlign: 'center', margin: '0 auto 32px' }}>Why AINative wins</h2>
          <div style={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', background: 'var(--color-divider)' }}>
            {DIFFERENTIATORS.map(([h, d]) => (
              <div key={h} style={{ background: 'var(--color-bg)', padding: 24, borderTop: '4px solid var(--color-accent)' }}>
                <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>{h}</h3>
                <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section style={{ maxWidth: 720, margin: '0 auto', padding: '0 24px 64px' }}>
          <h2 className="m-h1" style={{ fontSize: 28, textAlign: 'center', margin: '0 auto 32px' }}>Frequently asked questions</h2>
          <div style={{ display: 'grid', gap: 24 }}>
            {faqJsonLd.mainEntity.map((item) => (
              <div key={item.name} style={{ borderBottom: '2px solid var(--color-divider)', paddingBottom: 24 }}>
                <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 18, marginBottom: 12 }}>{item.name}</h3>
                <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>{item.acceptedAnswer.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section style={{ borderTop: '2px solid var(--color-divider)', background: 'var(--color-surface)' }}>
          <div style={{ maxWidth: 640, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
            <h2 className="m-h1" style={{ fontSize: 32, margin: '0 auto 16px' }}>Stop building from scratch</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 32 }}>Describe your idea. Cody builds the company and runs it — on real primitives you own.</p>
            <Link href="/build" className="btn-primary" style={{ textDecoration: 'none' }}>Build your company free →</Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
