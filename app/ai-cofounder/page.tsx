import type { Metadata } from 'next'
import Link from 'next/link'
import { PublicNav } from '@/components/shared/public-nav'
import { PublicFooter } from '@/components/shared/public-footer'

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
    <div className="modernist" style={{ minHeight: '100vh' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <PublicNav />
      <main>
        <section style={{ maxWidth: 900, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
          <p className="m-eyebrow" style={{ marginBottom: 16 }}>Your AI co-founder</p>
          <h1 className="m-h1" style={{ margin: '0 auto 20px' }}>
            An AI co-founder that <span style={{ color: 'var(--color-accent)' }}>builds and runs</span> your company
          </h1>
          <p style={{ fontSize: 19, color: 'var(--text-muted)', marginBottom: 32, maxWidth: 640, marginInline: 'auto' }}>
            Meet Cody — the AI employee that turns your idea into a real running product and the
            company around it, then operates it 24/7 while you sleep. You own 100%.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
            <Link href="/build" className="btn-primary" style={{ textDecoration: 'none' }}>Start with your AI co-founder →</Link>
            <Link href="/autonomous-company-builder" className="btn-secondary" style={{ textDecoration: 'none' }}>Build a SaaS overnight →</Link>
          </div>
        </section>

        <section style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px 64px' }}>
          <h2 className="m-h1" style={{ fontSize: 28, textAlign: 'center', margin: '0 auto 32px' }}>How Cody works</h2>
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
          <h2 className="m-h1" style={{ fontSize: 28, textAlign: 'center', margin: '0 auto 32px' }}>Why Cody wins</h2>
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
            See how an AI co-founder compares to code generators and company-runners.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
            <Link href="/compare/polsia" className="btn-secondary" style={{ textDecoration: 'none' }}>vs Polsia</Link>
            <Link href="/compare/v0" className="btn-secondary" style={{ textDecoration: 'none' }}>vs v0</Link>
            <Link href="/compare/lovable" className="btn-secondary" style={{ textDecoration: 'none' }}>vs Lovable</Link>
            <Link href="/ai-company" className="btn-secondary" style={{ textDecoration: 'none' }}>The AI-native company →</Link>
          </div>
        </section>

        <section style={{ borderTop: '2px solid var(--color-divider)', background: 'var(--color-surface)' }}>
          <div style={{ maxWidth: 640, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
            <h2 className="m-h1" style={{ fontSize: 32, margin: '0 auto 16px' }}>Hire your AI co-founder</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 32 }}>Describe your idea. Cody builds the company and runs it — on real primitives you own.</p>
            <Link href="/build" className="btn-primary" style={{ textDecoration: 'none' }}>Start free →</Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
