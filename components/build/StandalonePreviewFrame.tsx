'use client'

/**
 * #1066 — the public /build/{slug} page always iframed /api/preview/{chatId},
 * which unconditionally flattens a multi-file generation into a single Babel
 * module (lib/build/flatten-multifile.ts). That flattened blob can contain
 * real syntax errors a clean multi-file source does not (confirmed live,
 * finio-product: a stray `}` only exists in the flattened code, not in any
 * of its real 18 source files) — so a genuinely working multi-file app's
 * PUBLIC page showed a fabricated "build needs another pass" error, with a
 * "Regenerate" button that would have burned a real generation cycle on an
 * app that was never broken.
 *
 * Same fix app/preview/[id]/page.tsx already applied for the standalone
 * preview page (#729): fetch the durable files map and route through
 * shouldUseSandpack() exactly like that page and components/build/artifacts/
 * Preview.tsx already do. Single-file apps have no durable files map, so
 * this always falls through to the existing iframe — their behavior is
 * unchanged.
 *
 * Preview-system resilience (found live, same session): Sandpack's own
 * bundler-side dependency fetch can hang forever with no error (unfixed
 * CodeSandbox/unpkg gap — see components/chat/sandpack-preview.tsx's doc
 * comment). A 15s watchdog (SandpackPreview's timeoutMs/onTimeout) falls
 * back to the flattened-code iframe if Sandpack hasn't finished by then —
 * strictly better than Sandpack's prior failure mode (blank forever), even
 * though the iframe fallback can itself show a fabricated "build failed"
 * for the reasons #1066 fixed elsewhere. A timed-out Sandpack render is
 * never retried automatically within the same mount — once this gives up on
 * Sandpack, it stays on the iframe path.
 */

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { shouldUseSandpack } from '@/lib/build/preview-engine'

const SandpackPreview = dynamic(
  () => import('@/components/chat/sandpack-preview').then((m) => m.SandpackPreview),
  { ssr: false, loading: () => <div style={{ padding: 24, fontSize: 14, color: '#6b7280' }}>Loading preview…</div> },
)

interface Props {
  chatId: string
  slug: string
  title: string
}

export function StandalonePreviewFrame({ chatId, slug, title }: Props) {
  const [files, setFiles] = useState<Record<string, string> | null>(null)
  const [checkedFiles, setCheckedFiles] = useState(false)
  const [sandpackTimedOut, setSandpackTimedOut] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/generation/${chatId}/files`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        setFiles(data?.files && Object.keys(data.files).length > 0 ? data.files : null)
      })
      .catch(() => { /* no durable multi-file map — the iframe path below still works */ })
      .finally(() => { if (!cancelled) setCheckedFiles(true) })
    return () => { cancelled = true }
  }, [chatId])

  const useSandpack = checkedFiles && shouldUseSandpack(files) && !sandpackTimedOut

  if (useSandpack && files) {
    return (
      <div style={{ flex: 1, minHeight: 0, width: '100%' }}>
        <SandpackPreview
          files={files}
          className="w-full h-full"
          timeoutMs={15000}
          onTimeout={() => setSandpackTimedOut(true)}
        />
      </div>
    )
  }

  return (
    <iframe
      src={`/api/preview/${chatId}?slug=${encodeURIComponent(slug)}`}
      title={title}
      style={{ flex: 1, border: 0, width: '100%' }}
      sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
    />
  )
}
