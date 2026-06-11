import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { SEED_SHOWCASE, SHOWCASE_CATEGORIES } from '@/lib/showcase-data'
import { getDynamicShowcase } from '@/lib/showcase-store'

interface Props {
  params: Promise<{ slug: string }>
}

function findEntry(slug: string) {
  return SEED_SHOWCASE.find(e => e.slug === slug) || getDynamicShowcase().find(e => e.slug === slug)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const entry = findEntry(slug)
  if (!entry) return { title: 'Not Found' }

  return {
    title: `${entry.title} — AI-Generated React App | AINative Builder`,
    description: entry.description,
    openGraph: {
      title: `${entry.title} — Built with AI in Seconds`,
      description: entry.description,
      url: `https://builder.ainative.studio/showcase/${slug}`,
      type: 'article',
    },
    alternates: {
      canonical: `https://builder.ainative.studio/showcase/${slug}`,
    },
    keywords: [...entry.tags, 'ai-generated', 'react', 'tailwind', 'component', 'ainative'],
  }
}

export function generateStaticParams() {
  return SEED_SHOWCASE.map(entry => ({ slug: entry.slug }))
}

export default async function ShowcaseDetailPage({ params }: Props) {
  const { slug } = await params
  const entry = findEntry(slug)
  if (!entry) notFound()

  const category = SHOWCASE_CATEGORIES.find(c => c.id === entry.category)
  const allEntries = [...SEED_SHOWCASE, ...getDynamicShowcase()]
  const related = allEntries.filter(e => e.category === entry.category && e.slug !== slug).slice(0, 3)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black" data-agent-role="application" data-agent-context={`showcase: ${entry.title}`}>
      <header className="bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800" data-agent-role="navigation">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <nav className="flex items-center gap-3 text-sm text-gray-500 mb-4" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-gray-900 dark:hover:text-white transition-colors">Home</Link>
            <span>/</span>
            <Link href="/showcase" className="hover:text-gray-900 dark:hover:text-white transition-colors">Showcase</Link>
            <span>/</span>
            <span className="text-gray-900 dark:text-white font-medium">{entry.title}</span>
          </nav>

          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">
                  {category?.label || entry.category}
                </span>
                {entry.featured && (
                  <span className="text-xs font-medium text-amber-600 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">
                    Featured
                  </span>
                )}
              </div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                {entry.title}
              </h1>
              <p className="text-gray-600 dark:text-gray-400 max-w-2xl">
                {entry.description}
              </p>
            </div>
            <div className="flex gap-3 shrink-0">
              <Link
                href={`/?prompt=${encodeURIComponent(entry.prompt)}`}
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-lg transition-colors"
                aria-label={`Try building ${entry.title} yourself`}
              >
                Try This Prompt
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-agent-role="content">
        {/* Live preview — renders the already-generated app via iframe */}
        <section className="mb-10" aria-label="App preview">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
            <div className="bg-gray-100 dark:bg-gray-800 px-4 py-2 flex items-center gap-2 border-b border-gray-200 dark:border-gray-700">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-400" />
                <div className="w-3 h-3 rounded-full bg-yellow-400" />
                <div className="w-3 h-3 rounded-full bg-green-400" />
              </div>
              <span className="text-xs text-gray-500 ml-2 font-mono">preview — {entry.title.toLowerCase().replace(/\s+/g, '-')}.app</span>
            </div>
            {entry.chatId ? (
              <iframe
                src={`/api/preview/${entry.chatId}`}
                className="w-full border-0"
                style={{ height: '70vh' }}
                title={`Preview of ${entry.title}`}
                sandbox="allow-scripts allow-same-origin"
                loading="lazy"
              />
            ) : (
              <div className="aspect-video bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-sm text-gray-400 dark:text-gray-500 mb-3">
                    Preview available after generation
                  </p>
                  <Link
                    href={`/?prompt=${encodeURIComponent(entry.prompt)}`}
                    className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm"
                  >
                    Generate This App
                  </Link>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Prompt used */}
        <section className="mb-10" aria-label="Prompt used">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Prompt Used</h2>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
            <p className="text-gray-700 dark:text-gray-300 font-mono text-sm leading-relaxed whitespace-pre-wrap">
              {entry.prompt}
            </p>
          </div>
        </section>

        {/* Tags */}
        <section className="mb-10" aria-label="Tags">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Tags</h2>
          <div className="flex flex-wrap gap-2">
            {entry.tags.map(tag => (
              <span key={tag} className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full">
                {tag}
              </span>
            ))}
          </div>
        </section>

        {/* Tech stack */}
        <section className="mb-10" aria-label="Technology stack">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Built With</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { name: 'React 19', desc: 'UI Framework' },
              { name: 'Tailwind CSS', desc: 'Styling' },
              { name: 'Lucide Icons', desc: 'Iconography' },
              { name: 'Recharts', desc: 'Data Visualization' },
            ].map(tech => (
              <div key={tech.name} className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-3">
                <div className="font-medium text-sm text-gray-900 dark:text-white">{tech.name}</div>
                <div className="text-xs text-gray-500">{tech.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Related apps */}
        {related.length > 0 && (
          <section aria-label="Related apps">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              More {category?.label}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              {related.map(r => (
                <Link
                  key={r.slug}
                  href={`/showcase/${r.slug}`}
                  className="group block bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 hover:shadow-md hover:border-blue-300 transition-all"
                >
                  <h3 className="font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 transition-colors mb-1">
                    {r.title}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">{r.description}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* CTA */}
        <section className="mt-16 text-center py-12 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
            Build Your Own App with AI
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md mx-auto">
            Describe any web application and get production-ready React code in seconds.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
          >
            Start Building Free
          </Link>
        </section>
      </main>

      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: entry.title,
            description: entry.description,
            applicationCategory: 'WebApplication',
            operatingSystem: 'Web',
            url: `https://builder.ainative.studio/showcase/${entry.slug}`,
            datePublished: entry.createdAt,
            creator: {
              '@type': 'Organization',
              name: 'AINative Builder',
              url: 'https://builder.ainative.studio',
            },
            keywords: entry.tags.join(', '),
          }),
        }}
      />
    </div>
  )
}
