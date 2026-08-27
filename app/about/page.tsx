/**
 * /about — Founder story + vision page
 *
 * SSR, Modernist chrome, Article + Organization + Person JSON-LD.
 * Newsreader serif for the narrative body.
 *
 * NOTE: The copy below is a FIRST DRAFT placeholder. Toby should revise every
 * paragraph to reflect his own voice and specific story. The structure,
 * JSON-LD, and styling are production-ready.
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AppHeader } from '@/components/shared/app-header'

// Founder direction: the story is dated August 2025 (top byline + footer).
const PUBLISHED_DATE = '2025-08-24'
const MODIFIED_DATE = '2026-08-24'
const AUTHOR_NAME = 'Toby'
const ORG_NAME = 'AINative Studio'
const ORG_URL = 'https://ainative.studio'
const PAGE_URL = 'https://builder.ainative.studio/about'

export const metadata: Metadata = {
  title: 'About — Why I Built AINative Builder | Toby, AINative Studio',
  description:
    "Toby's first-person founder story: from employee #1 at IdeaMarket (Bill Gross's Idealab) to Techstars Tulsa to AINative Builder — a decade removing the friction between idea and market, and the vision of Cody, an AI co-founder that builds a real app you own, then runs the company.",
  keywords: [
    'AINative Builder founder story',
    'why I built AINative',
    'IdeaMarket Idealab Bill Gross',
    'IdeaMarket employee 1',
    'Techstars Tulsa 2023',
    'AI co-founder story',
    'founder vision AINative',
    'Cody AI co-founder',
    'AINative Studio mission',
    'AI that builds your company',
    'own your AI company',
  ],
  openGraph: {
    title: 'About — Why I Built AINative Builder',
    description:
      'The founder story behind AINative Builder: a real app you own, built by Cody, then run autonomously — no black boxes, no revenue share.',
    type: 'article',
    publishedTime: PUBLISHED_DATE,
    authors: [AUTHOR_NAME],
  },
  alternates: {
    canonical: PAGE_URL,
  },
}

// ── JSON-LD ──────────────────────────────────────────────────────────────────

const articleJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Why I Built AINative Builder — and What Cody Really Is',
  datePublished: PUBLISHED_DATE,
  dateModified: MODIFIED_DATE,
  url: PAGE_URL,
  description:
    "Toby's first-person account of why he built AINative Builder: the gap between AI tools and a real AI co-founder that builds AND runs your company on primitives you fully own.",
  author: {
    '@type': 'Person',
    name: AUTHOR_NAME,
    jobTitle: 'Founder',
    worksFor: {
      '@type': 'Organization',
      name: ORG_NAME,
      url: ORG_URL,
    },
  },
  publisher: {
    '@type': 'Organization',
    name: ORG_NAME,
    url: ORG_URL,
    logo: {
      '@type': 'ImageObject',
      url: 'https://builder.ainative.studio/ainative-logo-v2.png',
    },
  },
  mainEntityOfPage: {
    '@type': 'WebPage',
    '@id': PAGE_URL,
  },
}

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: ORG_NAME,
  url: ORG_URL,
  logo: 'https://builder.ainative.studio/ainative-logo-v2.png',
  description:
    'AINative Studio builds open-source AI infrastructure — ZeroDB, ZeroPipeline, ZeroInvoice, ServiceOS, ZeroVoice — and the Builder platform that lets anyone compose a real, running company from a single idea.',
  sameAs: [
    'https://github.com/AINative-Studio',
    'https://twitter.com/AINativeStudio',
  ],
  foundingDate: '2024',
  founders: [
    {
      '@type': 'Person',
      name: AUTHOR_NAME,
      jobTitle: 'Founder & CEO',
    },
  ],
}

const personJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: AUTHOR_NAME,
  jobTitle: 'Founder & CEO',
  worksFor: {
    '@type': 'Organization',
    name: ORG_NAME,
    url: ORG_URL,
  },
  url: PAGE_URL,
  sameAs: [
    'https://twitter.com/AINativeStudio',
    'https://github.com/AINative-Studio',
  ],
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }}
      />

      <AppHeader />

      <main id="about-story" className="container mx-auto px-4 py-16 max-w-3xl">
        {/* Dateline + byline */}
        <header className="mb-12">
          <p className="text-sm text-muted-foreground uppercase tracking-widest mb-3 font-medium">
            Founder Story
          </p>
          <h1
            className="text-4xl md:text-5xl leading-tight mb-6"
            style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 500 }}
          >
            Why I Built AINative Builder
          </h1>
          <p className="text-muted-foreground text-sm">
            By {AUTHOR_NAME}&nbsp;&mdash;&nbsp;
            {new Date(PUBLISHED_DATE).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </header>

        {/* Article body — Newsreader serif for editorial prose */}
        <article
          className="space-y-8 text-lg leading-relaxed"
          style={{ fontFamily: 'var(--font-newsreader), Georgia, serif' }}
        >
          {/* FINAL founder narrative (Toby, 2026-08-27): IdeaMarket → Techstars
              Tulsa → AINative, tightened around idea-to-customer. */}
          <section aria-label="From IdeaMarket to AINative">
            <h2
              className="text-2xl mb-4"
              style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 500 }}
            >
              From IdeaMarket to AINative.
            </h2>

            <p>
              I&apos;ve been obsessed with one problem for a long time:{' '}
              <strong>how do we remove the friction between an idea and the market?</strong>
            </p>

            <p className="mt-6">
              Years ago, I was employee #1 at <strong>IdeaMarket</strong>, an Idealab company
              founded by Bill Gross. I developed the initial UI/UX and product concepts and drove
              product and the development team.
            </p>

            <p className="mt-6">
              The idea was essentially a reverse venture capital network: start with promising
              ideas, then match them with the <strong>entrepreneurs, talent, and capital</strong>{' '}
              needed to bring them to market.
            </p>

            <p className="mt-6">
              Investors and entrepreneurs including{' '}
              <strong>
                Steve Case, Shervin Pishevar, Max Levchin, and others invested in IdeaMarket and
                submitted ideas to the platform. Peter Diamandis was an advisor and idea
                collaborator.
              </strong>
            </p>

            <p className="mt-6">
              The model was simple: <strong>Idea → Talent → Capital → Market</strong>. That
              experience left me with a question I&apos;ve carried ever since:{' '}
              <strong>
                how quickly can we get from a good idea to finding out whether customers actually
                want it?
              </strong>
            </p>

            <p className="mt-6">
              Years later, I encountered that problem again. During the{' '}
              <strong>Spring 2023 Techstars Tulsa cohort</strong>, I was mentoring founders in a
              three-month accelerator. These were talented entrepreneurs with ideas, mentors,
              networks, and access to investors. But I watched some of them burn the most valuable
              early weeks of the program simply trying to get an MVP built.
            </p>

            <p className="mt-6">
              And I kept thinking:{' '}
              <strong>
                by week four, you shouldn&apos;t still be building something to test. You should
                already be learning from customers.
              </strong>
            </p>

            <p className="mt-6">That became the catalyst for AINative.</p>
          </section>

          <hr className="border-border" />

          <section aria-label="The real gap">
            <h2
              className="text-2xl mb-4"
              style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 500 }}
            >
              The real gap isn&apos;t idea-to-code. It&apos;s idea-to-customer.
            </h2>

            <p>
              Generative AI has made building software dramatically faster. But an application
              isn&apos;t a company. You still need data, authentication, deployment, billing, CRM,
              support, communications, AI infrastructure, and all the other pieces required to
              turn software into something customers can actually use.
            </p>

            <p className="mt-6">
              So instead of asking, <strong>&ldquo;How can AI generate more code?&rdquo;</strong>{' '}
              I started asking:{' '}
              <strong>
                &ldquo;How do we remove as many steps as possible between an entrepreneur and
                their first customer?&rdquo;
              </strong>
            </p>

            <p className="mt-6">
              That&apos;s why we&apos;re building AINative around composable primitives:{' '}
              <strong>
                ZeroDB, ZeroPipeline, ZeroInvoice, ServiceOS, ZeroVoice, agent infrastructure,
                inference, memory, and Cody
              </strong>{' '}
              to help bring those pieces together.
            </p>

            <p className="mt-6">
              The goal isn&apos;t more code. <strong>The goal is faster learning.</strong> Because
              AI can&apos;t manufacture product-market fit. Customers still decide whether your
              idea deserves to become a company. AI can change how quickly you get to ask them.
            </p>

            <p className="mt-6">
              What once looked like:{' '}
              <strong>
                Idea → Team → Capital → Build → Infrastructure → Deploy → Customer → Learn
              </strong>{' '}
              can increasingly become:{' '}
              <strong>Idea → Product → Customer → Learn → Iterate</strong>.
            </p>

            <p className="mt-6">
              That&apos;s the thread connecting IdeaMarket, Techstars Tulsa, and AINative. The
              technology has changed. <strong>My obsession hasn&apos;t.</strong>
            </p>

            <p className="mt-6">
              I want to compress the distance between{' '}
              <strong>idea and customer to almost zero</strong> — so founders can spend less time
              getting ready to learn and more time actually learning. And that&apos;s the mission
              I&apos;m inviting you to join.
            </p>

            <p className="mt-6">
              If you&apos;re a founder, developer, investor, or builder who believes great ideas
              should have a faster path to the people they might serve,{' '}
              <strong>come help us build that future.</strong>
            </p>

            <p className="mt-6">
              Let&apos;s make it easier to try. Faster to learn. Cheaper to fail. And easier to
              try again.
            </p>

            <p className="mt-6"><strong>That&apos;s why I built this. Come build something.</strong></p>
          </section>

          {/* Signed byline */}
          <footer className="pt-4">
            <p
              className="text-xl"
              style={{
                fontFamily: 'var(--font-newsreader), Georgia, serif',
                fontStyle: 'italic',
              }}
            >
              &mdash; {AUTHOR_NAME}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Founder, {ORG_NAME}&nbsp;&bull;&nbsp;
              {new Date(PUBLISHED_DATE).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
              })}
            </p>
          </footer>
        </article>

        {/* CTA */}
        <div className="mt-16 pt-8 border-t border-border text-center">
          <p className="text-muted-foreground mb-6 text-base">
            Ready to build your company with Cody?
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg">
              <Link href="/build">Start Building Free</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/compare/polsia">How we compare</Link>
            </Button>
          </div>
        </div>
      </main>

      {/* Page-level footer with nav links */}
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
            <Link href="/showcase" className="hover:text-foreground transition-colors">
              Showcase
            </Link>
            <Link href="/guides" className="hover:text-foreground transition-colors">
              Guides
            </Link>
            <Link href="/templates" className="hover:text-foreground transition-colors">
              Templates
            </Link>
            <Link
              href="/about"
              className="hover:text-foreground transition-colors font-medium text-foreground"
              aria-current="page"
            >
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
