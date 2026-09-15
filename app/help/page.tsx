/**
 * /help — AI Help Center (#60)
 *
 * "How can we help?" + an AI "Ask anything" box that answers grounded in
 * Builder/AINative docs + a curated FAQ (RAG via /api/build/help), plus Guides
 * and FAQ cards. SSR with FAQPage JSON-LD (AEO) — reuses the EXACT structured-
 * data pattern from app/compare/[competitor] + app/best/[category] + app/about.
 *
 * This page is on the public middleware allowlist (/help) so it is crawlable and
 * usable without an account — same requirement that previously bit /best + /about.
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { PublicNav } from '@/components/shared/public-nav'
import { FAQ_ENTRIES, faqPageJsonLd } from '@/lib/build/help-faq'
import { HelpAskBox } from './HelpAskBox'
import { ImStuck } from '@/components/help/ImStuck'

const PAGE_URL = 'https://builder.ainative.studio/help'
const ORG_NAME = 'AINative Studio'

export const metadata: Metadata = {
  title: 'Help Center — Ask Anything About AINative Builder | Cody',
  description:
    'AINative Builder Help Center: ask anything and get an AI answer grounded in our docs and FAQ, browse Guides, and read the FAQ. How to build, deploy, own, and run your app with Cody.',
  keywords: [
    'AINative Builder help',
    'AINative Builder support',
    'how to use AINative Builder',
    'Cody AI help',
    'AINative Builder FAQ',
    'AINative Builder docs',
    'ask anything AINative',
  ],
  openGraph: {
    title: 'Help Center — Ask Anything About AINative Builder',
    description:
      'Ask anything and get an AI answer grounded in Builder/AINative docs + FAQ. Guides, FAQ, and self-serve help.',
    type: 'website',
  },
  alternates: {
    canonical: PAGE_URL,
  },
}

// ── JSON-LD ──────────────────────────────────────────────────────────────────

const faqJsonLd = faqPageJsonLd(FAQ_ENTRIES)

const webPageJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: 'AINative Builder Help Center',
  url: PAGE_URL,
  description:
    'Self-serve Help Center for AINative Builder with an AI "ask anything" box grounded in docs and FAQ, plus Guides and FAQ.',
  publisher: {
    '@type': 'Organization',
    name: ORG_NAME,
    url: 'https://ainative.studio',
  },
}

// FAQ category groupings for the rendered FAQ section.
const CATEGORY_LABELS: Record<string, string> = {
  'getting-started': 'Getting started',
  building: 'Building',
  deploying: 'Deploying',
  billing: 'Billing & plans',
  ownership: 'Ownership',
  ai: 'AI & agents',
}

export default function HelpPage() {
  const categories = Array.from(new Set(FAQ_ENTRIES.map((e) => e.category)))

  return (
    <div className="modernist" style={{ minHeight: '100vh' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageJsonLd) }}
      />

      <PublicNav />

      <main>
        {/* Hero + AI ask box */}
        <section style={{ maxWidth: 640, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
          <p className="m-eyebrow" style={{ marginBottom: 16 }}>Help Center</p>
          <h1 className="m-h1" style={{ margin: '0 auto 16px' }}>How can we help?</h1>
          <p style={{ fontSize: 17, color: 'var(--text-muted)', marginBottom: 32 }}>
            Ask anything about AINative Builder and get an answer grounded in our
            docs and FAQ — or browse the guides and FAQ below.
          </p>

          <HelpAskBox />
        </section>

        {/* Guides + FAQ cards */}
        <section style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px 16px' }}>
          <div style={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', background: 'var(--color-divider)' }}>
            <Link
              href="/guides"
              style={{ background: 'var(--color-bg)', padding: 24, textDecoration: 'none', color: 'inherit', borderTop: '4px solid var(--color-divider)' }}
              data-agent-role="guides-link"
            >
              <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
                Guides &rarr;
              </h2>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Long-form walkthroughs: how to build a SaaS with AI, tool
                comparisons, and AX optimization.
              </p>
            </Link>

            <a
              href="#faq"
              style={{ background: 'var(--color-bg)', padding: 24, textDecoration: 'none', color: 'inherit', borderTop: '4px solid var(--color-divider)' }}
              data-agent-role="faq-link"
            >
              <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
                FAQ &rarr;
              </h2>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Quick answers about building, deploying, ownership, billing, and
                the autonomous loop.
              </p>
            </a>
          </div>
        </section>

        {/* FAQ Section — SSR, structured for FAQPage JSON-LD + featured snippets */}
        <section id="faq" style={{ maxWidth: 720, margin: '0 auto', padding: '64px 24px' }} data-agent-role="faq">
          <h2 className="m-h1" style={{ fontSize: 28, textAlign: 'center', margin: '0 auto 32px' }}>
            Frequently Asked Questions
          </h2>

          {categories.map((cat) => (
            <div key={cat} style={{ marginBottom: 40 }}>
              <h3 className="m-mono" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-muted)', marginBottom: 16 }}>
                {CATEGORY_LABELS[cat] || cat}
              </h3>
              <div style={{ display: 'grid', gap: 24 }}>
                {FAQ_ENTRIES.filter((e) => e.category === cat).map((item) => (
                  <div key={item.id} id={item.id} style={{ border: '1.5px solid var(--color-divider)', padding: 24 }}>
                    <h4 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 18, marginBottom: 12 }}>{item.question}</h4>
                    <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
                      {item.answer}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* "I'm stuck" jump-to-answer (#321) — searches every guide section +
            FAQ entry and deep-links straight to the answer. Sits at the bottom
            of the page so a reader who scrolled the whole FAQ without finding
            their answer gets a targeted next step. */}
        <section style={{ maxWidth: 720, margin: '0 auto', padding: '0 24px 64px' }} aria-label="Stuck? Find the answer">
          <ImStuck />
        </section>

        {/* Bottom CTA */}
        <section style={{ borderTop: '2px solid var(--color-divider)', background: 'var(--color-surface)' }}>
          <div style={{ maxWidth: 640, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
            <h2 className="m-h1" style={{ fontSize: 32, margin: '0 auto 16px' }}>Ready to build?</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 32 }}>
              Describe your idea and watch Cody build a real app — free to start,
              no account required.
            </p>
            <Link href="/build" className="btn-primary" style={{ textDecoration: 'none' }}>
              Start Building Free
            </Link>
          </div>
        </section>
      </main>

      {/* Footer nav — data-agent-role="navigation" + a real "Help" link are
          load-bearing e2e contracts (e2e/help-center.spec.ts); kept as a
          page-local footer instead of PublicFooter for that reason. */}
      <footer style={{ borderTop: '2px solid var(--color-divider)', marginTop: 32, padding: '32px 24px' }} data-agent-role="navigation">
        <nav
          className="m-mono"
          style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', fontSize: 12, color: 'var(--text-muted)', justifyContent: 'center', textTransform: 'uppercase', letterSpacing: '.04em' }}
          aria-label="Footer navigation"
        >
          <Link href="/" style={{ color: 'inherit', textDecoration: 'none' }}>Home</Link>
          <Link href="/build" style={{ color: 'inherit', textDecoration: 'none' }}>Builder</Link>
          <Link href="/guides" style={{ color: 'inherit', textDecoration: 'none' }}>Guides</Link>
          <Link href="/help" style={{ color: 'var(--color-text)', textDecoration: 'none', fontWeight: 700 }} aria-current="page">Help</Link>
          <Link href="/about" style={{ color: 'inherit', textDecoration: 'none' }}>About</Link>
        </nav>
        <p className="m-mono" style={{ textAlign: 'center', fontSize: 10.5, color: 'var(--text-faint)', marginTop: 16 }}>
          &copy; {new Date().getFullYear()} {ORG_NAME}. All rights reserved.
        </p>
      </footer>
    </div>
  )
}
