'use client'

/**
 * Real preview generation (#207 · B1) — turns the Preview artifact from a static
 * mock into the ACTUAL app built from the founder's idea, reusing the builder's
 * existing codegen + preview pipeline (/api/chat-ws → preview store →
 * /api/preview/{id}).
 *
 * On mount (once), it POSTs the idea to /api/chat-ws and reads the SSE stream
 * ONLY to learn the chatId (the `init` event) and to know when to refresh the
 * iframe (`refresh`/`files`/`error`). Generation runs server-side and populates
 * the preview store keyed by that chatId; we render /api/preview/{chatId} in the
 * browser frame. Works for anonymous/free users (server-side key).
 *
 * Returns { previewUrl, status, refreshKey } for the Preview component to render.
 */

import { useEffect, useRef, useState } from 'react'

type Status = 'idle' | 'generating' | 'ready' | 'error'

export function useRealPreview(idea: string, enabled: boolean) {
  const [chatId, setChatId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [refreshKey, setRefreshKey] = useState(0)
  const started = useRef(false)

  useEffect(() => {
    if (!enabled || started.current || !idea) return
    started.current = true
    setStatus('generating')

    const ac = new AbortController()
    let gotChatId: string | null = null

    ;(async () => {
      try {
        const res = await fetch('/api/chat-ws', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ac.signal,
          body: JSON.stringify({
            message:
              `Build a polished, working single-page web app for this idea: ${idea}. ` +
              `Make it interactive and visually complete with realistic sample data.`,
          }),
        })
        if (!res.body) { setStatus('error'); return }

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
              gotChatId = payload.chatId
              setChatId(payload.chatId)
            } else if (payload.type === 'refresh' || payload.type === 'files') {
              // don't flip to "ready" yet — a refresh can fire on partial/empty
              // content. We confirm renderable content after the stream ends.
              setRefreshKey((k) => k + 1)
            } else if (payload.type === 'error') {
              setStatus('error')
            }
          }
        }

        // Stream ended. Confirm the preview actually has RENDERABLE content
        // before showing it — the pipeline can occasionally return an empty/too-
        // short body (e.g. a failed primary model), which /api/preview renders as
        // "No renderable code found". Verify, and if empty, do NOT show it.
        if (gotChatId) {
          const ok = await previewHasContent(gotChatId, ac.signal)
          if (ok) {
            setStatus('ready')
            setRefreshKey((k) => k + 1)
          } else if (!ac.signal.aborted) {
            setStatus('error')
          }
        } else if (!ac.signal.aborted) {
          setStatus('error')
        }
      } catch (e) {
        if (!ac.signal.aborted) setStatus('error')
      }
    })()

    return () => ac.abort()
  }, [enabled, idea])

  const previewUrl = chatId && status === 'ready' ? `/api/preview/${chatId}?r=${refreshKey}` : null
  return { previewUrl, status, chatId }
}

/**
 * Does /api/preview/{id} have real renderable content? The route returns a
 * "No renderable code found" stub (small body) when generation produced nothing
 * usable. We treat that stub — and any suspiciously tiny body — as "not ready"
 * so the Preview shows a building/retry state instead of a broken frame.
 */
async function previewHasContent(id: string, signal: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`/api/preview/${id}`, { signal })
    if (!res.ok) return false
    const html = await res.text()
    if (/No renderable code found/i.test(html)) return false
    return html.length > 800
  } catch {
    return false
  }
}
