'use client'

/**
 * #1068 — the showcase page's Featured strip (app/showcase/page.tsx,
 * capped at 6 entries) rendered a live app thumbnail by directly iframing
 * /api/preview/{chatId}, scaled to 40%. That route always flattens a
 * multi-file generation into a single Babel module
 * (lib/build/flatten-multifile.ts), which can introduce syntax errors a
 * clean multi-file source doesn't have — the same root cause fixed for the
 * full /build/{slug} page in #1066. A broken thumbnail is lower-stakes than
 * a broken full page, but still a fabricated "this app is broken" signal on
 * the page whose whole purpose is showing real, working businesses.
 *
 * Same shouldUseSandpack() gating as StandalonePreviewFrame, scaled down and
 * non-interactive (pointer-events:none at the call site) for card use. The
 * Featured strip is capped at 6 entries, so per-card Sandpack bundling here
 * is cheap — this is NOT meant for an unbounded grid.
 */

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { shouldUseSandpack } from '@/lib/build/preview-engine'

const SandpackPreview = dynamic(
  () => import('@/components/chat/sandpack-preview').then((m) => m.SandpackPreview),
  { ssr: false, loading: () => null },
)

interface Props {
  chatId: string
  title: string
}

export function ShowcaseThumbnail({ chatId, title }: Props) {
  const [files, setFiles] = useState<Record<string, string> | null>(null)
  const [checkedFiles, setCheckedFiles] = useState(false)

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

  const useSandpack = checkedFiles && shouldUseSandpack(files)

  if (useSandpack && files) {
    return (
      <div style={{ transformOrigin: 'top left', width: '250%', height: '250%', transform: 'scale(0.4)' }}>
        <SandpackPreview files={files} showRefreshButton={false} />
      </div>
    )
  }

  return (
    <iframe
      src={`/api/preview/${chatId}`}
      title={`Live preview of ${title}`}
      loading="lazy"
      tabIndex={-1}
      aria-hidden="true"
      style={{ transformOrigin: 'top left', border: 0, width: '250%', height: '250%', transform: 'scale(0.4)' }}
    />
  )
}
