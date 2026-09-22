'use client'

/**
 * DocumentsPanel test harness — /test-components/documents-panel
 *
 * Mounts DocumentsPanel in isolation (#820 verification) so Playwright can
 * check the empty-state starter-doc CTA's visual treatment without a real
 * signed-in company. /api/build/documents is intercepted client-side here:
 * `?empty=1` (default) serves an empty library; `?empty=0` serves one
 * populated document, to check for regressions in the non-empty state.
 */

import { useEffect, useState } from 'react'
import { DocumentsPanel } from '@/components/build/DocumentsPanel'
import '@/app/modernist.css'

const EMPTY_LIST = {
  documents: [],
  counts: { all: 0, document: 0, report: 0 },
  kinds: [
    { kind: 'all', label: 'All' },
    { kind: 'document', label: 'Documents' },
    { kind: 'report', label: 'Reports' },
  ],
}

const POPULATED_LIST = {
  documents: [
    {
      id: 'doc-1',
      kind: 'document',
      type: 'research',
      typeLabel: 'Research',
      title: 'Market Research — Acme Co.',
      createdAt: new Date(Date.now() - 3600_000).toISOString(),
    },
  ],
  counts: { all: 1, document: 1, report: 0 },
  kinds: [
    { kind: 'all', label: 'All' },
    { kind: 'document', label: 'Documents' },
    { kind: 'report', label: 'Reports' },
  ],
}

export default function DocumentsPanelTestPage() {
  const [ready, setReady] = useState(false)
  const [lastGenerate, setLastGenerate] = useState<string | null>(null)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const empty = q.get('empty') !== '0'
    const origFetch = window.fetch.bind(window)
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/build/documents')) {
        if (init?.method === 'POST') {
          const body = init.body ? JSON.parse(String(init.body)) : {}
          setLastGenerate(JSON.stringify(body))
          return new Response(
            JSON.stringify({
              document: {
                id: 'generated-1',
                kind: 'document',
                type: body.type,
                typeLabel: body.type,
                title: `Generated ${body.type}`,
                createdAt: new Date().toISOString(),
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response(JSON.stringify(empty ? EMPTY_LIST : POPULATED_LIST), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return origFetch(input, init)
    }) as typeof window.fetch
    setReady(true)
    return () => {
      window.fetch = origFetch
    }
  }, [])

  if (!ready) return null

  return (
    <div className="modernist" style={{ minHeight: '100vh', background: '#f5f4f2', padding: 24 }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <DocumentsPanel
          companyId="test-co"
          idea="A tool that helps founders ship faster"
          companyName="Acme Co."
          track="app"
          canExportDeck={false}
        />
        {lastGenerate && (
          <p data-testid="harness-last-generate" style={{ fontFamily: 'monospace', fontSize: 11, marginTop: 16 }}>
            {lastGenerate}
          </p>
        )}
      </div>
    </div>
  )
}
