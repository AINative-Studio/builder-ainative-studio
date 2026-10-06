'use client'

/**
 * Cody chat panel (#BLD-06.1) — the persistent right-hand panel replacing
 * the old Artifacts rail drawer. This story ships the panel SHELL only: a
 * real, visible, always-on chat surface that reacts to the current
 * artifact. The guided conversation itself (step summaries, Q&A, revise,
 * save/restore) is BLD-06.2 through BLD-06.4's scope, not this one's —
 * the input below is honestly disabled rather than wired to fake behavior
 * that doesn't exist yet.
 */

import { useEffect, useRef, useState } from 'react'
import { useBuild } from '@/contexts/build-context'

export function CodyChatPanel() {
  const { state } = useBuild()
  // #BLD-06.2 — real, LLM-generated step summaries, cached per-view for this
  // component's lifetime only (no persistence — a reload re-summarizing is
  // cheap and avoids a new persistence surface for throwaway text).
  const summaryCache = useRef<Map<string, string>>(new Map())
  const [summary, setSummary] = useState<string | null>(summaryCache.current.get(state.view) || null)

  useEffect(() => {
    const cached = summaryCache.current.get(state.view)
    if (cached) { setSummary(cached); return }
    setSummary(null)
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/build/cody-summary', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ view: state.view, track: state.track, content: state.generated?.[state.view] }),
        })
        const d = await res.json().catch(() => null)
        if (!cancelled && d?.ok && d?.summary) {
          summaryCache.current.set(state.view, d.summary)
          setSummary(d.summary)
        }
      } catch { /* keep the static fallback line — never block the panel on this */ }
    })()
    return () => { cancelled = true }
  }, [state.view, state.track, state.generated])

  return (
    <div className="m-cody-chat-panel" data-testid="cody-chat-panel" aria-label="Cody chat">
      <div className="m-cody-chat-header m-mono">
        <span className="m-glyph">◇</span> Cody
      </div>
      <div className="m-cody-chat-log">
        <p className="m-cody-chat-line">
          {summary || (<>You&apos;re on <span className="m-mono">{state.view}</span>.</>)}
        </p>
      </div>
      <div className="m-cody-chat-input-row">
        <input
          className="m-cody-chat-input"
          data-testid="cody-chat-input"
          type="text"
          placeholder="Guided Q&A coming soon"
          disabled
        />
      </div>
    </div>
  )
}
