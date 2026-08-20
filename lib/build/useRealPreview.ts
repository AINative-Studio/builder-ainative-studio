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
              setChatId(payload.chatId)
            } else if (payload.type === 'refresh' || payload.type === 'files') {
              setStatus('ready')
              setRefreshKey((k) => k + 1)
            } else if (payload.type === 'error') {
              setStatus('error')
            }
          }
        }
        // stream ended — if we got a chatId, the app is in the store
        setStatus((s) => (s === 'error' ? s : 'ready'))
        setRefreshKey((k) => k + 1)
      } catch (e) {
        if (!ac.signal.aborted) setStatus('error')
      }
    })()

    return () => ac.abort()
  }, [enabled, idea])

  const previewUrl = chatId ? `/api/preview/${chatId}?r=${refreshKey}` : null
  return { previewUrl, status, chatId }
}
