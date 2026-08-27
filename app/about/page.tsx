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
          {/* Definitive founder narrative (Toby, 2026-08-27): IdeaMarket → Techstars
              Tulsa → AINative, framed around compressing idea-to-customer. */}
          <section aria-label="From IdeaMarket to AINative">
            <h2
              className="text-2xl mb-4"
              style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 500 }}
            >
              From IdeaMarket to AINative.
            </h2>

            <p>
              When I look back, there&apos;s a clear thread connecting the things I&apos;ve spent
              years working on.
            </p>

            <p className="mt-6">
              At <strong>IdeaMarket</strong>, where I was employee #1, I developed the initial
              UI/UX and product concepts and drove product and the development team. We were
              building a marketplace around a simple but ambitious premise: promising ideas could
              be matched with the <strong>entrepreneurs, talent, and capital</strong> required to
              bring them to market.
            </p>

            <p className="mt-6">
              Well-known entrepreneurs and investors — including{' '}
              <strong>
                Steve Case, Shervin Pishevar, Max Levchin, and others — invested in IdeaMarket and
                submitted ideas to the platform. Peter Diamandis was an advisor and idea
                collaborator.
              </strong>
            </p>

            <p className="mt-6">
              The model was essentially: <strong>Idea → Talent → Capital → Market</strong>. That
              experience shaped a question I&apos;ve continued to pursue:{' '}
              <strong>
                how much friction can we remove between someone having a valuable idea and
                discovering whether the market actually wants it?
              </strong>
            </p>

            <p className="mt-6">
              Years later, during the <strong>Spring 2023 Techstars Tulsa cohort</strong>, I
              encountered that problem again from a different perspective. I was mentoring founders
              in a three-month accelerator. These were talented people with promising ideas,
              mentors, networks, and access to potential investors. But I watched founders lose
              some of the most valuable weeks of the program simply trying to get an MVP built.
            </p>

            <p className="mt-6">
              That bothered me. Because in a three-month accelerator, by week four you
              shouldn&apos;t still be fighting with the machinery required to test your idea.{' '}
              <strong>You should already be learning from customers.</strong>
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
              Generative AI created an extraordinary opportunity to accelerate software
              development. But faster code generation doesn&apos;t solve the entire problem. An
              entrepreneur still needs data infrastructure, authentication, deployment, billing,
              customer management, support, analytics, communications, AI inference, memory, and
              all the other systems surrounding a real product.
            </p>

            <p className="mt-6">
              So I started thinking about AINative differently. Instead of asking{' '}
              <strong>how can AI generate an application faster?</strong> I asked:{' '}
              <strong>
                what infrastructure would allow an entrepreneur to move from an idea to a real
                customer interaction as quickly as possible?
              </strong>
            </p>

            <p className="mt-6">
              That&apos;s why we started building AINative as a collection of composable
              primitives. ZeroDB for data and intelligence. ZeroPipeline for customer
              relationships. ZeroInvoice for billing. ServiceOS for customer service. ZeroVoice
              for communications. Agent infrastructure, inference, memory, and operational
              services underneath them. And Cody as the interface that helps developers and
              founders put those capabilities together.
            </p>

            <p className="mt-6">
              The objective isn&apos;t simply to generate more software.{' '}
              <strong>
                It&apos;s to eliminate as many steps as possible between an entrepreneur and their
                first meaningful customer learning.
              </strong>
            </p>
          </section>

          <hr className="border-border" />

          <section aria-label="Compressing the feedback loop">
            <h2
              className="text-2xl mb-4"
              style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 500 }}
            >
              We&apos;re compressing the feedback loop.
            </h2>

            <p>
              This distinction matters. AI cannot manufacture product-market fit. It can&apos;t
              guarantee that an idea deserves to become a company. Customers still make that
              decision. What AI can change is <strong>how quickly you get to ask them.</strong>
            </p>

            <p className="mt-6">
              Historically, an entrepreneur might move through:{' '}
              <strong>
                Idea → Team → Capital → Development → Infrastructure → Deployment → Customer →
                Feedback
              </strong>
              . Every arrow represents time, money, coordination, and risk.
            </p>

            <p className="mt-6">
              What I&apos;ve been pursuing since IdeaMarket is the ability to compress that
              journey: <strong>Idea → Product → Customer → Learn → Iterate</strong>. That&apos;s
              the opportunity I see in AI-native development.
            </p>

            <p className="mt-6">
              Because the scarce resource for an early-stage entrepreneur isn&apos;t ideas.{' '}
              <strong>It&apos;s learning cycles.</strong> How many times can you put something real
              in front of customers, discover something you didn&apos;t know, and improve the
              product before you run out of time, money, or momentum?
            </p>

            <p className="mt-6">
              If technology allows an entrepreneur to run ten meaningful learning cycles in the
              time it previously took to run one, that changes the economics of experimentation.
              And potentially entrepreneurship itself.
            </p>
          </section>

          <hr className="border-border" />

          <section aria-label="A pursuit that predates the AI wave">
            <h2
              className="text-2xl mb-4"
              style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 500 }}
            >
              This is a pursuit that predates the current AI wave.
            </h2>

            <p>
              That&apos;s important to me. AINative wasn&apos;t born from watching the latest
              generation of AI products and deciding that I wanted to build another one. The
              underlying problem has been something I&apos;ve been thinking about for years.
            </p>

            <p className="mt-6">
              At IdeaMarket, we attempted to reduce the distance between{' '}
              <strong>ideas and opportunity</strong> by bringing together ideas, entrepreneurs,
              talent, and capital. At Techstars Tulsa, I saw how much friction still existed
              between <strong>founders and customers</strong>, even when many of those other
              ingredients were present.
            </p>

            <p className="mt-6">
              AI gave me a new way to attack that same old problem. Instead of requiring
              entrepreneurs to assemble every piece of technical infrastructure themselves, what
              if we could make those capabilities available as primitives they could compose?
              Instead of spending weeks getting ready to learn, what if they could start learning
              almost immediately?
            </p>

            <p className="mt-6">
              That&apos;s the opportunity behind AINative. And that&apos;s the north star:{' '}
              <strong>compress the distance between idea and customer to almost zero.</strong>
            </p>

            <p className="mt-6">
              Not because every idea should become a company. But because every entrepreneur
              should have the opportunity to discover, as quickly and inexpensively as possible,
              whether their idea deserves to become one.
            </p>

            <p className="mt-6">That&apos;s why I built this. Come build something.</p>
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
