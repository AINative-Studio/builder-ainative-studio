import { Metadata } from 'next'
import Link from 'next/link'
import { SEED_SHOWCASE, SHOWCASE_CATEGORIES, type ShowcaseEntry } from '@/lib/showcase-data'
import { ShowcaseGalleryClient } from './showcase-client'

export const metadata: Metadata = {
  title: 'Showcase — AI-Generated React Apps | AINative Builder',
  description: 'Browse beautiful, production-ready React applications generated entirely by AI. Dashboards, landing pages, e-commerce, chat interfaces, and more — all built with AINative Builder in seconds.',
  openGraph: {
    title: 'AI App Showcase — AINative Builder',
    description: 'See what AI can build. Browse 50+ production-ready React apps generated in seconds.',
    url: 'https://builder.ainative.studio/showcase',
  },
  alternates: {
    canonical: 'https://builder.ainative.studio/showcase',
  },
}

function ShowcaseCard({ entry }: { entry: ShowcaseEntry }) {
  const category = SHOWCASE_CATEGORIES.find(c => c.id === entry.category)

  return (
    <Link
      href={`/showcase/${entry.slug}`}
      className="group block bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-700 transition-all duration-200"
      data-agent-role="content"
      data-agent-context={`showcase entry: ${entry.title}`}
    >
      <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-50 dark:from-gray-800 dark:to-gray-900 relative overflow-hidden">
        {/* Static screenshot — fast, reliable, pre-rendered */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/showcase-thumbnails/${entry.slug}.png`}
          alt={`Preview of ${entry.title}`}
          className="w-full h-full object-cover object-top"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-transparent group-hover:bg-black/5 transition-colors" />
        {entry.featured && (
          <span className="absolute top-3 right-3 bg-blue-600 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider z-10">
            Featured
          </span>
        )}
      </div>
      <div className="p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">
            {category?.label || entry.category}
          </span>
        </div>
        <h3 className="font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 transition-colors mb-1">
          {entry.title}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
          {entry.description}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {entry.tags.slice(0, 3).map(tag => (
            <span key={tag} className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </Link>
  )
}

export default function ShowcasePage() {
  // Only show entries with good quality thumbnails as featured
  const bestThumbnails = ['analytics-dashboard', 'kanban-task-board', 'saas-landing-page', 'team-directory', 'ecommerce-product-page']
  const featured = SEED_SHOWCASE.filter(e => bestThumbnails.includes(e.slug))
  const all = SEED_SHOWCASE

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black" data-agent-role="application" data-agent-context="showcase gallery of AI-generated React apps">
      <header className="bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800" data-agent-role="navigation">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <nav className="flex items-center gap-3 text-sm text-gray-500 mb-4" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-gray-900 dark:hover:text-white transition-colors">Home</Link>
            <span>/</span>
            <span className="text-gray-900 dark:text-white font-medium">Showcase</span>
          </nav>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-3">
            AI App Showcase
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl">
            Production-ready React applications generated entirely by AI in seconds.
            Each app was built with a single prompt using AINative Builder.
          </p>
          <div className="mt-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-lg transition-colors"
              aria-label="Try building your own app"
            >
              Build Your Own
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-agent-role="content">
        {/* Featured — top 5 curated with screenshots */}
        <section aria-label="Featured apps" className="mb-12">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">Featured</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {featured.map(entry => (
              <ShowcaseCard key={entry.slug} entry={entry} />
            ))}
          </div>
        </section>

        {/* ALL generated apps — live preview thumbnails, filterable by category */}
        <section aria-label="All generated apps">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            All Generated Apps
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Every app below was built with a single prompt — click to view the live preview
          </p>
          <ShowcaseGalleryClient />
        </section>

        {/* CTA to build your own */}
        <section aria-label="Build your own" className="mt-12 text-center py-12 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
            Build Your Own App
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
            Describe any app in plain English and get production-ready React code in seconds.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-3 rounded-lg transition-colors"
          >
            Start Building
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
          </Link>
        </section>

        {/* SEO content */}
        <section className="mt-16 prose prose-gray dark:prose-invert max-w-none" aria-label="About the showcase">
          <h2>What is AINative Builder?</h2>
          <p>
            AINative Builder is an AI-powered application builder that generates production-ready
            React components from natural language prompts. Describe what you want — a dashboard,
            landing page, chat interface, or any web application — and get working code in seconds.
          </p>
          <h3>How are these apps generated?</h3>
          <p>
            Every app in this showcase was generated by a single prompt. The AI analyzes your
            requirements, selects appropriate components (Tailwind CSS, Lucide icons, Recharts,
            shadcn/ui), generates complete React code, and renders it in a live preview — all
            within seconds.
          </p>
          <h3>Can I use these in my projects?</h3>
          <p>
            Yes! All generated code is yours to use. Export any project as a complete Next.js
            application with a single click. The generated code uses modern React patterns,
            TypeScript, and Tailwind CSS — ready for production deployment.
          </p>
        </section>
      </main>

      <footer className="border-t border-gray-200 dark:border-gray-800 py-8 mt-12" data-agent-role="navigation">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-sm text-gray-500">
          Built with AINative Builder
        </div>
      </footer>

      {/* JSON-LD structured data for SEO */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: 'AI App Showcase — AINative Builder',
            description: 'Browse production-ready React applications generated entirely by AI.',
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
