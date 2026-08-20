'use client'

/**
 * Shared helpers for wired artifact bodies (#207) — used by both app and company
 * artifact sets. `useGen` reads generated content for a view (null while
 * pending), and the small presentational bits (Section/Tag/Generating) keep the
 * Modernist markup consistent across every artifact.
 */

import type { ReactNode } from 'react'
import { useBuild } from '@/contexts/build-context'

export function Section({ h, children }: { h: string; children: ReactNode }) {
  return (
    <section className="m-sec">
      <h2 className="m-artifact m-sec-h">{h}</h2>
      <div className="m-sec-body">{children}</div>
    </section>
  )
}

export function Tag({ kind, children }: { kind: 'assumption' | 'evidence'; children: ReactNode }) {
  return <span className={`m-inline-tag is-${kind} m-mono`}>{children}</span>
}

export function Generating({ lines = 4 }: { lines?: number }) {
  return (
    <div className="m-gen-pending" aria-live="polite">
      <p className="m-artifact-meta m-mono"><span className="m-glyph">◇</span> Cody is drafting this from your idea…</p>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="m-shimmer m-gen-line" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  )
}

export function GenError({ error }: { error: string }) {
  return <p className="m-artifact-meta m-mono is-error">Generation failed ({error}) — showing an example.</p>
}

/** Read generated content for a view; data is null while pending. */
export function useGen<T = any>(view: string): { data: T | null; error: string | null } {
  const { state } = useBuild()
  return {
    data: (state.generated[view] as T) ?? null,
    error: state.genError[view] || null,
  }
}
