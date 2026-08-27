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
import { AppHeader } from '@/components/shared/app-header'
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
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageJsonLd) }}
      />

      <AppHeader />

      <main>
        {/* Hero + AI ask box */}
        <section className="container mx-auto px-4 py-16 text-center max-w-3xl">
          <p className="text-sm text-muted-foreground uppercase tracking-widest mb-3 font-medium">
            Help Center
          </p>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-4">
            How can we help?
          </h1>
          <p className="text-lg text-muted-foreground mb-8">
            Ask anything about AINative Builder and get an answer grounded in our
            docs and FAQ — or browse the guides and FAQ below.
          </p>

          <HelpAskBox />
        </section>

        {/* Guides + FAQ cards */}
        <section className="container mx-auto px-4 pb-4 max-w-4xl">
          <div className="grid gap-6 md:grid-cols-2">
            <Link
              href="/guides"
              className="group border rounded-lg p-6 hover:border-foreground/40 transition-colors block"
              data-agent-role="guides-link"
            >
              <h2 className="font-semibold text-lg mb-2 group-hover:text-foreground">
                Guides &rarr;
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Long-form walkthroughs: how to build a SaaS with AI, tool
                comparisons, and AX optimization.
              </p>
            </Link>

            <a
              href="#faq"
              className="group border rounded-lg p-6 hover:border-foreground/40 transition-colors block"
              data-agent-role="faq-link"
            >
              <h2 className="font-semibold text-lg mb-2 group-hover:text-foreground">
                FAQ &rarr;
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Quick answers about building, deploying, ownership, billing, and
                the autonomous loop.
              </p>
            </a>
          </div>
        </section>

        {/* FAQ Section — SSR, structured for FAQPage JSON-LD + featured snippets */}
        <section
          id="faq"
          className="container mx-auto px-4 py-16 max-w-3xl"
          data-agent-role="faq"
        >
          <h2 className="text-2xl font-bold mb-8 text-center">
            Frequently Asked Questions
          </h2>

          {categories.map((cat) => (
            <div key={cat} className="mb-10">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
                {CATEGORY_LABELS[cat] || cat}
              </h3>
              <div className="space-y-6">
                {FAQ_ENTRIES.filter((e) => e.category === cat).map((item) => (
                  <div key={item.id} id={item.id} className="border rounded-lg p-6">
                    <h4 className="font-semibold text-lg mb-3">{item.question}</h4>
                    <p className="text-muted-foreground leading-relaxed">
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
        <section
          className="container mx-auto px-4 pb-16 max-w-3xl"
          aria-label="Stuck? Find the answer"
        >
          <ImStuck />
        </section>

        {/* Bottom CTA */}
        <section className="border-t bg-muted/30">
          <div className="container mx-auto px-4 py-16 text-center max-w-2xl">
            <h2 className="text-3xl font-bold mb-4">Ready to build?</h2>
            <p className="text-muted-foreground mb-8">
              Describe your idea and watch Cody build a real app — free to start,
              no account required.
            </p>
            <Link
              href="/build"
              className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Start Building Free
            </Link>
          </div>
        </section>
      </main>

      {/* Footer nav */}
      <footer className="border-t border-border mt-8 py-8" data-agent-role="navigation">
        <div className="container mx-auto px-4 max-w-3xl">
          <nav
            className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground justify-center"
            aria-label="Footer navigation"
          >
            <Link href="/" className="hover:text-foreground transition-colors">
              Home
            </Link>
            <Link href="/build" className="hover:text-foreground transition-colors">
              Builder
            </Link>
            <Link href="/guides" className="hover:text-foreground transition-colors">
              Guides
            </Link>
            <Link
              href="/help"
              className="hover:text-foreground transition-colors font-medium text-foreground"
              aria-current="page"
            >
              Help
            </Link>
            <Link href="/about" className="hover:text-foreground transition-colors">
              About
            </Link>
          </nav>
          <p className="text-center text-xs text-muted-foreground mt-4">
            &copy; {new Date().getFullYear()} {ORG_NAME}. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
