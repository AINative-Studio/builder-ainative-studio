'use client'

/**
 * Standalone shared preview page (#729 fix, 2026-09-13).
 *
 * Real bug found live (verifying Cody composes AINative primitives correctly
 * — the PipeForge CRM test build): this page always iframed
 * /api/preview/{id}, which unconditionally flattens a multi-file app into a
 * single Babel module (lib/build/flatten-multifile.ts) regardless of file
 * count. Babel's bare `transform` preset (no @babel/preset-typescript) can't
 * parse real TS syntax generated apps legitimately contain — e.g. a `.tsx`
 * prop-types interface with a function-type field
 * (`onTabChange: (id: string) => void`) — so a genuinely valid multi-file app
 * 500'd with "Unexpected token" on this exact page, even though the SAME
 * files map renders correctly via Sandpack inside the live Builder chat UI
 * (components/build/artifacts/Preview.tsx, which already calls
 * shouldUseSandpack() correctly — this page just never did).
 *
 * Fix: fetch the durable files map (the same /api/generation/{id}/files
 * route the in-session Sandpack rehydration path already uses — see
 * lib/build/useRealPreview.ts) and route through shouldUseSandpack() exactly
 * like Preview.tsx does. Single-file apps are unaffected — they have no
 * durable files map, so this always falls through to the existing iframe.
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { shouldUseSandpack } from '@/lib/build/preview-engine'

const SandpackPreview = dynamic(
  () => import('@/components/chat/sandpack-preview').then((m) => m.SandpackPreview),
  { ssr: false, loading: () => <div className="p-6 text-sm text-gray-500">Loading multi-file preview…</div> },
)

export default function PreviewPage() {
  const params = useParams()
  const id = params.id as string

  const [files, setFiles] = useState<Record<string, string> | null>(null)
  const [checkedFiles, setCheckedFiles] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!id) {
      setCheckedFiles(true)
      return
    }
    fetch(`/api/generation/${id}/files`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        setFiles(data?.files && Object.keys(data.files).length > 0 ? data.files : null)
      })
      .catch(() => { /* no durable multi-file map — the iframe path below still works */ })
      .finally(() => { if (!cancelled) setCheckedFiles(true) })
    return () => { cancelled = true }
  }, [id])

  const useSandpack = checkedFiles && shouldUseSandpack(files)

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6 mb-4">
          <h1 className="text-2xl font-bold mb-2">Preview: {id}</h1>
          <p className="text-gray-600">Generated component preview</p>
        </div>

        <div className="bg-white rounded-lg shadow-lg overflow-hidden" style={{ height: '80vh' }}>
          {useSandpack && files ? (
            <SandpackPreview files={files} />
          ) : (
            <iframe
              src={`/api/preview/${id}`}
              className="w-full h-full border-0"
              title={`Preview ${id}`}
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
            />
          )}
        </div>
      </div>
    </div>
  )
}
