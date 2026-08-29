'use client'

/**
 * Shared helpers for wired artifact bodies (#207) — used by both app and company
 * artifact sets. `useGen` reads generated content for a view (null while
 * pending), and the small presentational bits (Section/Tag/Generating) keep the
 * Modernist markup consistent across every artifact.
 */

import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useBuild } from '@/contexts/build-context'
import { collectPrior } from '@/lib/build/artifact-edit'

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

/**
 * Shown when a view has NEVER produced content and every automatic attempt
 * (5 client retries × server-side provider fallback + JSON-repair, see
 * useAutoplay.ts / app/api/build/artifact/route.ts) has been exhausted.
 *
 * This is deliberately NOT an error state: a founder's free first look at their
 * product (the Company track's Landing artifact especially) should never read
 * as broken or generic — Cody is a co-founder still working the problem, not a
 * system throwing an error. Keeps the shimmer aesthetic of `Generating` so the
 * screen never visually "breaks"; `onRetry` is the same regenerate call as the
 * manual Retry action, just framed as Cody choosing to try a different angle.
 */
export function GenStuck({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div className="m-gen-pending" aria-live="polite">
      <p className="m-artifact-meta m-mono">
        <span className="m-glyph">◇</span>{' '}
        {retrying ? 'Cody is trying a different angle…' : "This one's taking longer than usual — Cody's still on it."}
      </p>
      <div className="m-shimmer m-gen-line" style={{ width: '90%' }} />
      <div className="m-shimmer m-gen-line" style={{ width: '78%' }} />
      <button className="btn-ghost m-artifact-action" disabled={retrying} onClick={onRetry}>
        {retrying ? 'Working…' : 'Have Cody try again'}
      </button>
    </div>
  )
}

/** Read generated content for a view; data is null while pending. */
export function useGen<T = any>(view: string): { data: T | null; error: string | null } {
  const { state } = useBuild()
  return {
    data: (state.generated[view] as T) ?? null,
    error: state.genError[view] || null,
  }
}

/**
 * Like useGen, but a view that has FAILED with no content ever landing keeps
 * fighting for it — automatically, in the background, with no click required —
 * instead of settling for a visible error or generic fallback copy. The 5-attempt
 * client retry (useAutoplay.ts) + per-provider JSON-repair pass (route.ts) already
 * cover almost every real failure; this is the belt-and-suspenders layer for the
 * rare view that reaches this component already errored (e.g. the founder
 * navigated back to it after autoplay gave up). One quiet background retry fires
 * on mount; `stuck` only stays true (surfacing GenStuck's manual "try again") once
 * that has ALSO failed — a founder should never have to click to get a working
 * product, only as an actual last resort.
 */
export function useGenAutoRetry<T = any>(
  view: string,
): { data: T | null; error: string | null; stuck: boolean; retrying: boolean; retry: () => void } {
  const { state, views, dispatch } = useBuild()
  const { data, error } = useGen<T>(view)
  const [retrying, setRetrying] = useState(false)
  const autoFired = useRef(false)

  const runRetry = () => {
    if (retrying || !state.idea) return
    setRetrying(true)
    fetch('/api/build/artifact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        view,
        idea: state.idea,
        track: state.track,
        companyName: state.companyName || undefined,
        prior: collectPrior(views, state.generated, view),
      }),
    })
      .then((res) => res.json().catch(() => null).then((data) => ({ res, data })))
      .then(({ res, data }) => {
        if (res.ok && data?.content) {
          dispatch({ type: 'GEN_DONE', view, content: data.content })
        } else {
          dispatch({ type: 'GEN_FAIL', view, error: data?.error || `HTTP ${res.status}` })
        }
      })
      .catch((e: unknown) => {
        dispatch({ type: 'GEN_FAIL', view, error: e instanceof Error ? e.message : String(e) })
      })
      .finally(() => setRetrying(false))
  }

  useEffect(() => {
    if (error && !data && !autoFired.current) {
      autoFired.current = true
      runRetry()
    }
    if (data) autoFired.current = false // a future failure on this view gets its own auto-retry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, error, data])

  return { data, error, stuck: !!error && !data, retrying, retry: runRetry }
}
