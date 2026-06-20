'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { SHOWCASE_CATEGORIES, type ShowcaseEntry } from '@/lib/showcase-data'

// Auto-detect category from prompt keywords
function detectCategory(prompt: string): string {
  const p = prompt.toLowerCase()
  if (p.includes('dashboard') || p.includes('analytics') || p.includes('monitor') || p.includes('metrics') || p.includes('metriccard')) return 'dashboard'
  if (p.includes('landing') || p.includes('hero section') || p.includes('pricing') || p.includes('testimonial')) return 'landing'
  if (p.includes('ecommerce') || p.includes('e-commerce') || p.includes('product') || p.includes('shopping') || p.includes('cart') || p.includes('store')) return 'ecommerce'
  if (p.includes('chat') || p.includes('message') || p.includes('social') || p.includes('chatbubble')) return 'social'
  if (p.includes('kanban') || p.includes('task') || p.includes('calendar') || p.includes('note') || p.includes('file manager') || p.includes('todo') || p.includes('project')) return 'productivity'
  if (p.includes('saas') || p.includes('team') || p.includes('crm') || p.includes('invoice') || p.includes('subscription') || p.includes('onboarding')) return 'saas'
  if (p.includes('music') || p.includes('recipe') || p.includes('weather') || p.includes('blog') || p.includes('portfolio') || p.includes('fitness') || p.includes('restaurant') || p.includes('menu')) return 'creative'
  return 'creative'
}

// Clean up auto-generated titles
function cleanTitle(title: string): string {
  return title
    .replace(/^Build\s+(a|an)\s+/i, '')
    .replace(/\s+with\s+.*/i, '')
    .replace(/\s+using\s+.*/i, '')
    .replace(/\s+for\s+"[^"]*"/, '')
    .split(',')[0]
    .trim()
    .split(' ')
    .slice(0, 5)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function CommunityCard({ entry }: { entry: ShowcaseEntry }) {
  const cat = detectCategory(entry.prompt || entry.title || '')
  const category = SHOWCASE_CATEGORIES.find(c => c.id === cat)
  const title = cleanTitle(entry.title || '')
  const previewUrl = entry.chatId ? `/api/preview/${entry.chatId}` : ''

  return (
    <Link
      href={entry.chatId ? `/chats/${entry.chatId}` : `/`}
      className="group block bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-700 transition-all duration-200"
    >
      {/* Live iframe preview thumbnail */}
      <div className="aspect-video bg-gray-100 dark:bg-gray-800 relative overflow-hidden">
        {previewUrl ? (
          <iframe
            src={previewUrl}
            className="w-[200%] h-[200%] origin-top-left scale-50 pointer-events-none border-0"
            loading="lazy"
            sandbox="allow-scripts"
            title={title}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
            Preview
          </div>
        )}
        <div className="absolute inset-0 bg-transparent group-hover:bg-black/5 transition-colors" />
      </div>

      {/* Card info */}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded-full">
            {category?.label || cat}
          </span>
        </div>
        <h3 className="font-semibold text-sm text-gray-900 dark:text-white group-hover:text-blue-600 transition-colors line-clamp-1">
          {title}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-1">
          {entry.description || entry.prompt?.slice(0, 100)}
        </p>
      </div>
    </Link>
  )
}

export function ShowcaseGalleryClient() {
  const [entries, setEntries] = useState<ShowcaseEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/showcase?offset=0&limit=100')
      .then(r => r.json())
      .then(data => {
        const dynamic = (data.entries || []).filter(
          (e: ShowcaseEntry) => e.chatId && !e.slug?.startsWith('showcase-')
        )
        setEntries(dynamic)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
          <div key={i} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden animate-pulse">
            <div className="aspect-video bg-gray-200 dark:bg-gray-700" />
            <div className="p-4">
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-2" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-1" />
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
        <p className="text-gray-500 dark:text-gray-400 mb-3">No community creations yet</p>
        <Link href="/" className="text-sm font-medium text-blue-600 hover:text-blue-700">
          Be the first to create one
        </Link>
      </div>
    )
  }

  // Apply category filter
  const filtered = filter
    ? entries.filter(e => detectCategory(e.prompt || e.title || '') === filter)
    : entries

  // Get unique categories from entries
  const cats = [...new Set(entries.map(e => detectCategory(e.prompt || e.title || '')))]

  return (
    <div>
      {/* Category filter pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setFilter(null)}
          className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${
            !filter
              ? 'bg-blue-600 text-white'
              : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-blue-300'
          }`}
        >
          All ({entries.length})
        </button>
        {cats.map(cat => {
          const label = SHOWCASE_CATEGORIES.find(c => c.id === cat)?.label || cat
          const count = entries.filter(e => detectCategory(e.prompt || e.title || '') === cat).length
          return (
            <button
              key={cat}
              onClick={() => setFilter(filter === cat ? null : cat)}
              className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${
                filter === cat
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-blue-300'
              }`}
            >
              {label} ({count})
            </button>
          )
        })}
      </div>

      {/* Grid of cards with live previews */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {filtered.map(entry => (
          <CommunityCard key={entry.chatId || entry.slug} entry={entry} />
        ))}
      </div>
    </div>
  )
}
