'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { SHOWCASE_CATEGORIES, type ShowcaseEntry } from '@/lib/showcase-data'

function CommunityCard({ entry }: { entry: ShowcaseEntry }) {
  const category = SHOWCASE_CATEGORIES.find(c => c.id === entry.category)

  return (
    <div
      className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden hover:shadow-md transition-shadow"
      data-agent-role="content"
    >
      <div className="p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">
            {category?.label || entry.category}
          </span>
          <span className="text-[11px] text-gray-400">
            {entry.createdAt}
          </span>
        </div>
        <h3 className="font-semibold text-gray-900 dark:text-white mb-1 line-clamp-1">
          {entry.title}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mb-3">
          {entry.prompt}
        </p>
        <div className="flex items-center gap-2">
          {entry.chatId && (
            <Link
              href={`/preview/${entry.chatId}`}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
            >
              View Preview
            </Link>
          )}
          <Link
            href={`/?prompt=${encodeURIComponent(entry.prompt)}`}
            className="text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            Try This Prompt
          </Link>
        </div>
      </div>
    </div>
  )
}

export function ShowcaseGalleryClient() {
  const [entries, setEntries] = useState<ShowcaseEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/showcase?offset=0&limit=100')
      .then(r => r.json())
      .then(data => {
        // Filter to only show dynamic entries with chatId (not seeds)
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
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 animate-pulse">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-3" />
            <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-2/3 mb-2" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full" />
          </div>
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
        <p className="text-gray-500 dark:text-gray-400 mb-3">No community creations yet</p>
        <Link
          href="/"
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Be the first to create one
        </Link>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
      {entries.map(entry => (
        <CommunityCard key={entry.slug} entry={entry} />
      ))}
    </div>
  )
}
