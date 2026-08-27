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

          {/* --- Origin: IdeaMarket --- */}
          <section aria-label="Where the pursuit really started">
            <h2
              className="text-2xl mb-4"
              style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 500 }}
            >
              Where the pursuit really started: IdeaMarket.
            </h2>

            <p>AINative didn&apos;t begin with generative AI.</p>

            <p className="mt-6">
              In many ways, I&apos;ve been working on this problem for more than a decade:{' '}
              <strong>how do we remove the friction between an idea and the market?</strong>
            </p>

            <p className="mt-6">
              Long before today&apos;s AI coding tools, I had firsthand experience trying to solve
              exactly that problem at <strong>IdeaMarket</strong>, an Idealab company founded by
              Bill Gross. I was <strong>employee #1 at IdeaMarket</strong>. I came up with the
              initial UI/UX and product concepts and then drove product development and the
              development team as we turned that vision into a working platform.
            </p>

            <p className="mt-6">
              The premise was ambitious: create what I thought of as a{' '}
              <strong>reverse venture capital network</strong>. Traditional venture capital starts
              with an entrepreneur who already has a company and is looking for money. We wanted to
              start earlier. <strong>Start with the idea.</strong>
            </p>

            <p className="mt-6">
              IdeaMarket was a curated, crowdsourced marketplace for ideas that could solve everyday
              problems, address unmet needs, and uncover entirely new business opportunities. What
              made the model especially interesting was who participated. Well-known entrepreneurs
              and investors — including{' '}
              <strong>
                Steve Case, Shervin Pishevar, Max Levchin, and others — were investors in IdeaMarket
                and also actively submitted ideas to the platform. Peter Diamandis was an advisor
                and idea collaborator.
              </strong>
            </p>

            <p className="mt-6">
              So instead of investors only evaluating ideas after entrepreneurs had turned them into
              startups, we were asking accomplished entrepreneurs, investors, and innovators to help
              surface opportunities themselves. Then IdeaMarket would do something unusual:{' '}
              <strong>match those ideas with talent and money to launch companies.</strong> The
              model was essentially: <strong>Idea → Entrepreneur → Talent → Capital → Company</strong>.
            </p>

            <p className="mt-6">
              I loved that problem. I became obsessed with the possibility that entrepreneurship
              itself could be redesigned — that we could create systems that systematically reduced
              the friction between someone recognizing an opportunity and actually getting a product
              into the market. My role put me right in the middle of that challenge. I wasn&apos;t
              just thinking about it theoretically. I was designing the initial product experience,
              determining how people would interact with ideas, and leading the development effort
              required to turn the concept into software.
            </p>

            <p className="mt-6">
              And it taught me something that has stayed with me ever since:{' '}
              <strong>
                great ideas aren&apos;t particularly scarce. The ability to turn them into something
                real is.
              </strong>
            </p>

            <p className="mt-6">
              At IdeaMarket, our answer was to build a network around the entrepreneur:{' '}
              <strong>Ideas + Talent + Capital.</strong> More than a decade later, AI made me
              realize there might be another way. What if we could put much of that capability{' '}
              <strong>directly into the hands of the entrepreneur?</strong>
            </p>
          </section>

          <hr className="border-border" />

          {/* --- The thread: IdeaMarket → Techstars → AINative --- */}
          <section aria-label="The thread from IdeaMarket to AINative">
            <h2
              className="text-2xl mb-4"
              style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 500 }}
            >
              The thread from IdeaMarket to AINative.
            </h2>

            <p>
              When I look back now, there&apos;s a very clear line connecting these experiences. At
              IdeaMarket our model was: <strong>Idea + Talent + Capital → Company</strong>.
            </p>

            <p className="mt-6">
              Then, during the <strong>Spring 2023 Techstars Tulsa cohort</strong>, I saw the other
              side of the equation. Even when founders had great ideas, mentorship, networks, and
              access to potential capital, they could still burn precious weeks just trying to build
              an MVP. That experience brought me back to the same question I&apos;d been pursuing
              since IdeaMarket: <strong>how do we remove the friction between idea and market?</strong>
            </p>

            <p className="mt-6">
              Only this time, something fundamental had changed. AI had arrived. At IdeaMarket, we
              tried to surround an idea with the human and financial resources required to turn it
              into a company. With AINative, I&apos;m asking whether we can give an entrepreneur an{' '}
              <strong>AI-native operating system for creating the company itself.</strong>{' '}
              Development. Infrastructure. Data. CRM. Billing. Customer support. Inference. Memory.
              Agents. Operations. And an AI-native technical co-founder — Cody — to help orchestrate
              it.
            </p>

            <p className="mt-6">
              So, in a way,{' '}
              <strong>
                AINative is the technological continuation of a problem I&apos;ve been obsessed with
                since IdeaMarket.
              </strong>{' '}
              IdeaMarket asked: <strong>how do we match great ideas with everything required to
              turn them into companies?</strong> AINative asks:{' '}
              <strong>
                what if we could put everything required to start building the company directly into
                the hands of the person with the idea?
              </strong>
            </p>

            <p className="mt-6">
              That&apos;s the journey from IdeaMarket to Techstars Tulsa to AINative. And the
              mission underneath all three has remained remarkably consistent:{' '}
              <strong>remove as much friction as possible between idea and market.</strong>
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
