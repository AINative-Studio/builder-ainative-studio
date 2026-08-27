'use client'

/**
 * Real preview generation (#207 · B1) — turns the Preview artifact from a static
 * mock into the ACTUAL app built from the founder's idea, reusing the builder's
 * existing codegen + preview pipeline (/api/chat-ws → preview store →
 * /api/preview/{id}).
 *
 * GENERATION SURVIVES NAVIGATION (founder bug 2026-08-27): the old hook aborted
 * the /api/chat-ws stream in its unmount cleanup, so ANY navigation away from
 * the Preview artifact mid-build — browsing artifacts after "Take the wheel",
 * clicking toward pricing, Auto Mode — killed the in-flight app build and the
 * founder's preview "disappeared". Generation state now lives at MODULE level,
 * keyed by idea: the stream runs to completion regardless of what's mounted,
 * and a remounting Preview re-attaches to the in-flight (or finished) run
 * instead of restarting it.
 *
 * Returns { previewUrl, status, chatId, files } for the Preview component.
 */

import { useEffect, useMemo, useReducer } from 'react'

type Status = 'idle' | 'generating' | 'ready' | 'error'

interface Gen {
  chatId: string | null
  status: Status
  files: Record<string, string> | null
  refreshKey: number
  listeners: Set<() => void>
}

// Module-level registry: one generation per idea for the lifetime of the page.
const gens = new Map<string, Gen>()

/** TEST-ONLY: clear the module-level registry so specs don't leak generation
 *  state across tests (each test reuses similar idea strings). */
export function __resetRealPreviewGens(): void {
  gens.clear()
}

function genFor(idea: string): Gen {
  let g = gens.get(idea)
  if (!g) {
    g = { chatId: null, status: 'idle', files: null, refreshKey: 0, listeners: new Set() }
    gens.set(idea, g)
  }
  return g
}

function notify(g: Gen) {
  for (const l of g.listeners) l()
}

async function runGeneration(idea: string, g: Gen): Promise<void> {
  try {
    const res = await fetch('/api/chat-ws', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Neutral framing (#291): don't force "single-page" — that biased every
        // idea toward a single-file blob and defeated the multi-file/Sandpack
        // path. The server's complexity analyzer decides scope: a simple idea
        // still yields one lean file (Babel), a complex one is split into
        // components (multi-file → Sandpack). See chat-ws multi-file emphasis.
        message:
          `Build a polished, working web app for this idea: ${idea}. ` +
          `Make it interactive and visually complete with realistic sample data.`,
      }),
    })
    if (!res.body) { g.status = 'error'; notify(g); return }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    // read the SSE stream: pull chatId from init, refresh on refresh/files
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const events = buf.split('\n\n')
      buf = events.pop() || ''
      for (const ev of events) {
        const line = ev.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue
        let payload: any
        try { payload = JSON.parse(line.slice(5).trim()) } catch { continue }
        if (payload.type === 'init' && payload.chatId) {
          g.chatId = payload.chatId
          notify(g)
        } else if (payload.type === 'files') {
          // Capture the multi-file payload for the Sandpack route (#291), then
          // trigger a refresh. Keep the latest non-empty map (a later event can
          // supersede an earlier partial one).
          if (payload.files && typeof payload.files === 'object' && Object.keys(payload.files).length > 0) {
            g.files = payload.files as Record<string, string>
          }
          g.refreshKey += 1
          notify(g)
        } else if (payload.type === 'refresh') {
          // don't flip to "ready" yet — a refresh can fire on partial/empty
          // content. We confirm renderable content after the stream ends.
          g.refreshKey += 1
          notify(g)
        } else if (payload.type === 'error') {
          g.status = 'error'
          notify(g)
        }
      }
    }

    // Files rehydrate (#333): if the SSE stream ended without a usable `files`
    // event (cut stream, proxy drop), refetch the map from the durable read
    // path so a multi-file app still takes the Sandpack route. Best-effort —
    // a 404 just means this is a single-file app (Babel path).
    if (g.chatId && !g.files) {
      try {
        const r = await fetch(`/api/generation/${g.chatId}/files`)
        if (r.ok) {
          const d = await r.json().catch(() => null)
          if (d?.files && typeof d.files === 'object' && Object.keys(d.files).length > 0) {
            g.files = d.files as Record<string, string>
          }
        }
      } catch { /* keep files null — single-file rendering still works */ }
    }

    // Stream ended. Confirm the preview actually has RENDERABLE content
    // before showing it — the pipeline can occasionally return an empty/too-
    // short body (e.g. a failed primary model), which /api/preview renders as
    // "No renderable code found". Verify, and if empty, do NOT show it.
    if (g.chatId) {
      const ok = await previewHasContent(g.chatId)
      if (ok) {
        g.status = 'ready'
        g.refreshKey += 1
      } else if (g.status !== 'error') {
        g.status = 'error'
      }
    } else if (g.status !== 'error') {
      g.status = 'error'
    }
    notify(g)
  } catch {
    g.status = 'error'
    notify(g)
  }
}

export function useRealPreview(idea: string, enabled: boolean) {
  const [, force] = useReducer((x: number) => x + 1, 0)
  const g = useMemo(() => genFor(idea || ''), [idea])

  useEffect(() => {
    if (!enabled || !idea) return
    const listener = () => force()
    g.listeners.add(listener)
    // Kick generation once per idea; a remount RE-ATTACHES to the same run
    // (or its finished result) instead of restarting or aborting it.
    if (g.status === 'idle') {
      g.status = 'generating'
      notify(g)
      void runGeneration(idea, g)
    } else {
      // Re-attached mid-flight or post-completion — sync this instance now.
      force()
    }
    return () => { g.listeners.delete(listener) }
  }, [enabled, idea, g])

  const previewUrl = g.chatId && g.status === 'ready' ? `/api/preview/${g.chatId}?r=${g.refreshKey}` : null
  // `files` is exposed so Preview.tsx can route a multi-file app to Sandpack (#291).
  return { previewUrl, status: g.status, chatId: g.chatId, files: g.files }
}

/**
 * Does /api/preview/{id} have real renderable content? The route returns a
 * "No renderable code found" stub (small body) when generation produced nothing
 * usable. We treat that stub — and any suspiciously tiny body — as "not ready"
 * so the Preview shows a building/retry state instead of a broken frame.
 */
async function previewHasContent(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/preview/${id}`)
    if (!res.ok) return false
    const html = await res.text()
    if (/No renderable code found/i.test(html)) return false
    return html.length > 800
  } catch {
    return false
  }
}
