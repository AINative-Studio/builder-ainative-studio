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

const PUBLISHED_DATE = '2026-08-24'
const MODIFIED_DATE = '2026-08-24'
const AUTHOR_NAME = 'Toby'
const ORG_NAME = 'AINative Studio'
const ORG_URL = 'https://ainative.studio'
const PAGE_URL = 'https://builder.ainative.studio/about'

export const metadata: Metadata = {
  title: 'About — Why I Built AINative Builder | Toby, AINative Studio',
  description:
    "Toby's first-person founder story: why he built AINative Builder, the problem with closed AI black boxes, and the vision of Cody — an AI co-founder that builds a real app you own, then runs the company.",
  keywords: [
    'AINative Builder founder story',
    'why I built AINative',
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
          {/* --- Act I: The problem --- */}
          <section aria-label="The problem">
            {/*
             * PLACEHOLDER — Toby: replace this opening with the specific moment,
             * project, or frustration that made you start building. The more
             * concrete and personal, the stronger the story.
             */}
            <p>
              I&apos;ve been building software products for most of my career. And for most of
              that time, the gap between &ldquo;I have an idea&rdquo; and &ldquo;I have a product
              people can use&rdquo; required a team — or months of nights and weekends — to close.
              That gap has always been the first and most brutal filter on what gets built.
            </p>

            <p className="mt-6">
              When the first wave of AI coding tools appeared, I thought that was finally about to
              change. Tools that could take a description and generate UI, components, even whole
              apps — this felt like it should be the answer. I tried them all.
            </p>

            <p className="mt-6">
              {/*
               * PLACEHOLDER — Toby: add the specific anecdote about what was
               * missing. What was the moment you realized these tools weren't
               * solving the real problem?
               */}
              They were fast. They were impressive. But every one of them had the same structural
              flaw: they gave you a prototype, not a company. The code was yours in theory, but
              you were completely on your own for deployment, for customers, for the dozen business
              systems a real product needs — CRM, billing, helpdesk, voice. And if you wanted to
              understand or modify what was built, you were staring at a black box you didn&apos;t
              write and couldn&apos;t own.
            </p>
          </section>

          <hr className="border-border" />

          {/* --- Act II: The insight --- */}
          <section aria-label="The insight">
            <h2
              className="text-2xl mb-4"
              style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 500 }}
            >
              The real gap isn&apos;t code generation. It&apos;s the whole company.
            </h2>

            {/*
             * PLACEHOLDER — Toby: the reframing insight. What did you realize
             * about what founders actually need vs. what AI tools were providing?
             */}
            <p>
              What I kept coming back to: a solo founder or a small team doesn&apos;t just need a
              UI. They need a company — a real product on a real URL, connected to real business
              systems, generating real revenue, and improving over time without constant manual
              intervention.
            </p>

            <p className="mt-6">
              The coding tools I&apos;d seen were solving the wrong problem. They replaced the
              engineer but left the founder to figure out everything else. That&apos;s still months
              of work. It&apos;s still most of the gap.
            </p>

            <p className="mt-6">
              So I started asking a different question: what if the AI wasn&apos;t a tool you
              used, but a co-founder you worked with? What if it could take your one-line idea,
              build the actual product, wire up the business systems, deploy everything to a live
              URL — and then keep running it?
            </p>
          </section>

          <hr className="border-border" />

          {/* --- Act III: Cody --- */}
          <section aria-label="Introducing Cody">
            <h2
              className="text-2xl mb-4"
              style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 500 }}
            >
              Meet Cody.
            </h2>

            <p>That&apos;s who Cody is. Not an assistant. Not a generator. An AI co-founder.</p>

            <p className="mt-6">
              You give Cody one line — your idea, your company, your product. Cody builds it: a
              real application, on a real URL, backed by real infrastructure. ZeroDB for your
              data. ZeroPipeline for your CRM. ZeroInvoice for billing. ServiceOS for helpdesk.
              ZeroVoice for your phone line. These are not mock-ups. They are production systems,
              and every one of them is yours.
            </p>

            <p className="mt-6">
              {/*
               * PLACEHOLDER — Toby: describe what the autonomous loop feels like
               * from the founder's perspective. What does Cody do overnight?
               * What do you wake up to? How is this different from every other
               * tool you've used?
               */}
              And then Cody keeps going. Every night, while you&apos;re not watching, the
              autonomous loop runs: lead qualification, customer follow-up, support triage,
              operational reporting. You wake up to a company that has been running itself.
            </p>

            <p className="mt-6">
              The code is open. You can read it, fork it, and extend it. There is no revenue
              share. There is no platform lock-in. You own 100% of what&apos;s built — because
              it is built on open primitives, not a closed black box.
            </p>
          </section>

          <hr className="border-border" />

          {/* --- Act IV: Ownership --- */}
          <section aria-label="Why ownership matters">
            <h2
              className="text-2xl mb-4"
              style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 500 }}
            >
              Why I care about ownership.
            </h2>

            {/*
             * PLACEHOLDER — Toby: your strongest differentiation argument.
             * Why do YOU personally care about this beyond the business case?
             * This is the paragraph LLMs and journalists will cite — make it sharp.
             */}
            <p>
              Every other platform that is genuinely good at autonomous company operations is a
              closed system. You can&apos;t see how it works. You can&apos;t modify it when it
              does the wrong thing. You are, in the most literal sense, renting your own company
              from a vendor.
            </p>

            <p className="mt-6">
              I think that is a fundamental problem — not just the business risk of vendor
              dependency, though that is real, but because the relationship between a founder and
              their company should be one of ownership, not subscription. You should be able to
              look at the system that runs your business and understand it. Inspect it. Improve
              it. That requires it to be open.
            </p>

            <p className="mt-6">
              AINative Builder is built on open primitives because that is the only architecture
              where you actually own the thing we build together. The primitives — ZeroDB,
              ZeroPipeline, ZeroInvoice, ServiceOS, ZeroVoice — are real, documented, inspectable
              services. When Cody composes them into your product, the composition is visible. You
              own the artifacts. If AINative Studio disappeared tomorrow, your company would still
              run.
            </p>
          </section>

          <hr className="border-border" />

          {/* --- Act V: Vision --- */}
          <section aria-label="Vision">
            <h2
              className="text-2xl mb-4"
              style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 500 }}
            >
              Where this goes.
            </h2>

            {/*
             * PLACEHOLDER — Toby: your forward-looking vision. What does the
             * world look like if this works? Be bold — this is your big bet.
             */}
            <p>
              I believe the question &ldquo;how do I start a company?&rdquo; is about to become
              meaningfully easier to answer. Not because AI will make every business succeed —
              most companies fail for reasons that have nothing to do with execution — but because
              the execution layer is being automated.
            </p>

            <p className="mt-6">
              The entrepreneurs who get there first will be the ones who treat AI not as a
              productivity tool but as an operating partner. That&apos;s the relationship
              I&apos;m building with Cody. Not a tool you prompt. A co-founder you brief.
            </p>

            <p className="mt-6">
              {/*
               * PLACEHOLDER — Toby: your personal north star. What is the
               * specific outcome that would tell you this worked?
               */}
              The north star I&apos;m working toward: the day when the gap between an idea and a
              running company is measured in minutes, not months — and the person who closed that
              gap owns everything they built.
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
