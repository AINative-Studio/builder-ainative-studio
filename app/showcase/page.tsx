import { Metadata } from 'next'
import Link from 'next/link'
import { SEED_SHOWCASE, SHOWCASE_CATEGORIES, type ShowcaseEntry } from '@/lib/showcase-data'
import { ShowcaseGalleryClient } from './showcase-client'
import { PublicNav } from '@/components/shared/public-nav'
import { PublicFooter } from '@/components/shared/public-footer'

export const metadata: Metadata = {
  title: 'Showcase — Real Businesses Built by Cody | AINative Builder',
  description: 'Browse real businesses that founders built by describing an idea to Cody, their AI co-founder — no code required. Side hustles, freelance tools, and small companies, each running on real AINative primitives.',
  openGraph: {
    title: 'Showcase — Real Businesses Built by Cody',
    description: 'No code, no developer — just an idea and a conversation with Cody. See what real founders have built.',
    url: 'https://builder.ainative.studio/showcase',
  },
  alternates: {
    canonical: 'https://builder.ainative.studio/showcase',
  },
}

function ShowcaseCard({ entry }: { entry: ShowcaseEntry }) {
  const category = SHOWCASE_CATEGORIES.find(c => c.id === entry.category)
  // Seeds have a pre-built /showcase/{slug} detail page; dynamic apps do NOT
  // (that route 404s for them). Dynamic apps open their live preview instead.
  const isDynamic = Boolean(entry.chatId)
  const href = isDynamic ? `/api/preview/${entry.chatId}` : `/showcase/${entry.slug}`

  return (
    <Link
      href={href}
      target={isDynamic ? '_blank' : undefined}
      rel={isDynamic ? 'noopener noreferrer' : undefined}
      className="group"
      style={{ display: 'block', background: 'var(--color-bg)', border: '1.5px solid var(--color-divider)', overflow: 'hidden' }}
      data-agent-role="content"
      data-agent-context={`showcase entry: ${entry.title}`}
    >
      <div style={{ aspectRatio: '16/9', background: 'var(--color-surface)', position: 'relative', overflow: 'hidden' }}>
        {/* Branded placeholder sits BEHIND everything, so it shows through while
            the live preview loads (and if it fails). */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 48, fontFamily: 'var(--font-heading)', fontWeight: 800, color: 'var(--neutral-line)', userSelect: 'none' }}>
            {(entry.title || '?').charAt(0).toUpperCase()}
          </span>
        </div>
        {entry.chatId ? (
          // Dynamic app: render the ACTUAL generated app as a live, non-interactive
          // thumbnail. Scaled to 1/2.5 and pinned so the full app fits the card.
          <div style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', overflow: 'hidden' }}>
            <iframe
              src={`/api/preview/${entry.chatId}`}
              title={`Live preview of ${entry.title}`}
              loading="lazy"
              tabIndex={-1}
              aria-hidden="true"
              style={{ transformOrigin: 'top left', border: 0, width: '250%', height: '250%', transform: 'scale(0.4)' }}
            />
          </div>
        ) : (
          // Seed: fast pre-rendered PNG screenshot.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/showcase-thumbnails/${entry.slug}.png`}
            alt={`Preview of ${entry.title}`}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', position: 'relative', zIndex: 1 }}
            loading="lazy"
          />
        )}
        <div style={{ position: 'absolute', inset: 0, zIndex: 2 }} className="group-hover:bg-black/5" />
        {entry.featured && (
          <span className="m-mono" style={{ position: 'absolute', top: 12, right: 12, background: 'var(--color-accent)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 8px', textTransform: 'uppercase', letterSpacing: '.06em', zIndex: 10 }}>
            Featured
          </span>
        )}
      </div>
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span className="m-mono" style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-accent)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            {category?.label || entry.category}
          </span>
        </div>
        <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, marginBottom: 4 }}>
          {entry.title}
        </h3>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {entry.description}
        </p>
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {entry.tags.slice(0, 3).map(tag => (
            <span key={tag} className="m-mono" style={{ fontSize: 10, color: 'var(--text-faint)', border: '1px solid var(--color-divider)', padding: '2px 6px' }}>
              {tag}
            </span>
          ))}
        </div>
      </div>
    </Link>
  )
}

async function getRecentApps(): Promise<ShowcaseEntry[]> {
  // Fetch the newest real generations server-side so the "Featured" strip
  // reflects what people are actually building, not a static seed list.
  try {
    const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://builder.ainative.studio'
    const res = await fetch(`${base}/api/showcase?offset=0&limit=12`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.entries || []).filter((e: ShowcaseEntry & { hasCode?: boolean; generatedCode?: string }) =>
      Boolean(e.chatId) && (e.hasCode ?? Boolean(e.generatedCode && e.generatedCode.length >= 2000)),
    )
  } catch {
    return []
  }
}

export default async function ShowcasePage() {
  // Featured = the most recent real builds (falls back to curated seeds if the
  // live read is empty/slow, so the strip never blanks).
  const recent = await getRecentApps()
  const bestThumbnails = ['agent-swarm-dashboard', 'analytics-dashboard', 'kanban-task-board', 'saas-landing-page', 'team-directory']
  const seedFeatured = SEED_SHOWCASE.filter(e => bestThumbnails.includes(e.slug))
  const featured = (recent.length >= 3 ? recent.slice(0, 6) : seedFeatured)
  const all = SEED_SHOWCASE

  return (
    <div className="modernist" style={{ minHeight: '100vh' }} data-agent-role="application" data-agent-context="showcase of real businesses founders built with Cody, their AI co-founder, no code required">
      <PublicNav />
      <header data-agent-role="navigation">
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '48px 24px 40px' }}>
          <nav className="m-mono" style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }} aria-label="Breadcrumb">
            <Link href="/" style={{ color: 'inherit' }}>Home</Link>
            <span>/</span>
            <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>Showcase</span>
          </nav>
          <h1 className="m-h1" style={{ fontSize: 40, margin: '0 0 12px' }}>Real Businesses, Built by Cody</h1>
          <p style={{ fontSize: 17, color: 'var(--text-muted)', maxWidth: 640 }}>
            Every business below started as one sentence from a founder — a side hustle, a
            freelance tool, a small company idea. No code, no developer. Cody, their AI
            co-founder, composed it from real AINative primitives and keeps running it.
          </p>
          <div style={{ marginTop: 16 }}>
            <Link href="/" className="btn-primary" style={{ textDecoration: 'none' }} aria-label="Describe your own idea to Cody">
              Build Your Own
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
            </Link>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 64px' }} data-agent-role="content">
        {/* Featured — top 5 curated with screenshots */}
        <section aria-label="Featured apps" style={{ marginBottom: 48 }}>
          <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 20, marginBottom: 24 }}>Featured</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
            {featured.map(entry => (
              <ShowcaseCard key={entry.slug} entry={entry} />
            ))}
          </div>
        </section>

        {/* ALL generated apps — live preview thumbnails, filterable by category */}
        <section aria-label="All generated apps">
          <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 20, marginBottom: 8 }}>
            All Businesses
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 24 }}>
            Every one below started as a single idea, described in plain English — click to see it live
          </p>
          <ShowcaseGalleryClient />
        </section>

        {/* CTA to build your own */}
        <section aria-label="Build your own" style={{ marginTop: 48, textAlign: 'center', padding: '48px 24px', background: 'var(--color-surface)', borderTop: '4px solid var(--color-accent)' }}>
          <h2 className="m-h1" style={{ fontSize: 28, margin: '0 auto 12px' }}>Start Your Own</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 24, maxWidth: 400, marginInline: 'auto' }}>
            No coding experience needed. Describe your idea in plain English, and Cody takes it from there.
          </p>
          <Link href="/" className="btn-primary" style={{ textDecoration: 'none' }}>
            Start Building
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
          </Link>
        </section>

        {/* SEO content */}
        <section className="m-artifact" style={{ marginTop: 64, fontSize: 16, lineHeight: 1.7, color: 'var(--color-text)' }} aria-label="About the showcase">
          <h2 style={{ fontSize: 24, fontWeight: 500 }}>What is AINative Builder?</h2>
          <p>
            AINative Builder is for people who have a business idea but aren't developers —
            side hustlers, freelancers, small business owners, and first-time entrepreneurs.
            Describe your idea in plain English to Cody, your AI co-founder, and Cody builds a
            real, working business around it — not just a mockup of one.
          </p>
          <h3 style={{ fontSize: 19, fontWeight: 500 }}>What makes this different from an AI app generator?</h3>
          <p>
            Most AI tools stop at generating code you then have to host, connect, and maintain
            yourself. Cody composes your business from AINative's own real, already-running
            systems — invoicing, payments, a customer pipeline, a phone number customers can
            text — so what you get is a working business from day one, not a prototype you
            still have to build. Cody keeps running it afterward: nightly checks, growth tasks,
            and real upkeep, the way a technical co-founder would.
          </p>
          <h3 style={{ fontSize: 19, fontWeight: 500 }}>Do I need to know how to code?</h3>
          <p>
            No. Every business in this showcase was started by someone describing an idea in a
            sentence or two — no code, no developer, no technical background required. If you
            can describe what you want your business to do, Cody can build it.
          </p>
        </section>
      </main>

      <PublicFooter />

      {/* JSON-LD structured data for SEO */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: 'Showcase — Real Businesses Built by Cody',
            description: 'Real businesses founders built by describing an idea to Cody, their AI co-founder — no code required.',
            url: 'https://builder.ainative.studio/showcase',
            numberOfItems: all.length,
            publisher: {
              '@type': 'Organization',
              name: 'AINative Studio',
              url: 'https://ainative.studio',
            },
            mainEntity: {
              '@type': 'ItemList',
              itemListElement: all.map((entry, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                url: `https://builder.ainative.studio/showcase/${entry.slug}`,
                name: entry.title,
                description: entry.description,
              })),
            },
          }),
        }}
      />
    </div>
  )
}
