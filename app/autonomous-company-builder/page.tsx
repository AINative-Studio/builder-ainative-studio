import type { Metadata } from 'next'
import Link from 'next/link'
import { PublicNav } from '@/components/shared/public-nav'
import { PublicFooter } from '@/components/shared/public-footer'

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
    <div className="modernist" style={{ minHeight: '100vh' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <PublicNav />
      <main>
        <section style={{ maxWidth: 900, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
          <p className="m-eyebrow" style={{ marginBottom: 16 }}>Autonomous company builder</p>
          <h1 className="m-h1" style={{ margin: '0 auto 20px' }}>
            Build a SaaS with AI <span style={{ color: 'var(--color-accent)' }}>overnight</span>
          </h1>
          <p style={{ fontSize: 19, color: 'var(--text-muted)', marginBottom: 32, maxWidth: 640, marginInline: 'auto' }}>
            An autonomous company builder that turns one idea into a real running SaaS — the product
            AND the company around it — then runs it 24/7 while you sleep. You own 100%.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
            <Link href="/build" className="btn-primary" style={{ textDecoration: 'none' }}>Build your SaaS free →</Link>
            <Link href="/ai-company" className="btn-secondary" style={{ textDecoration: 'none' }}>See the AI-native company →</Link>
          </div>
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

        <section style={{ maxWidth: 720, margin: '0 auto', padding: '0 24px 64px', textAlign: 'center' }}>
          <h2 className="m-h1" style={{ fontSize: 28, margin: '0 auto 16px' }}>Compare the alternatives</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
            See how an autonomous company builder stacks up against code generators and company-runners.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
            <Link href="/compare/polsia" className="btn-secondary" style={{ textDecoration: 'none' }}>vs Polsia</Link>
            <Link href="/compare/v0" className="btn-secondary" style={{ textDecoration: 'none' }}>vs v0</Link>
            <Link href="/compare/lovable" className="btn-secondary" style={{ textDecoration: 'none' }}>vs Lovable</Link>
            <Link href="/compare/bolt" className="btn-secondary" style={{ textDecoration: 'none' }}>vs Bolt</Link>
          </div>
        </section>

        <section style={{ borderTop: '2px solid var(--color-divider)', background: 'var(--color-surface)' }}>
          <div style={{ maxWidth: 640, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
            <h2 className="m-h1" style={{ fontSize: 32, margin: '0 auto 16px' }}>Start it tonight</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 32 }}>Describe your SaaS. Cody builds it overnight and runs it — on real primitives you own.</p>
            <Link href="/build" className="btn-primary" style={{ textDecoration: 'none' }}>Build your SaaS free →</Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
