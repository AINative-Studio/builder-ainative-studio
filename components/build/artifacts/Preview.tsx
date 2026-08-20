'use client'

/**
 * Running Preview (#223 §14, wired B1 #207) — the REAL generated app.
 *
 * Instead of a hardcoded "ask the company" mock, this generates an actual
 * working app from the founder's idea (useRealPreview → /api/chat-ws → preview
 * store) and renders it live in the browser-frame via an iframe on
 * /api/preview/{chatId}. Shows a "building…" state while it generates and a
 * graceful message if generation fails. The Make-it-real banner is preserved.
 */

import { useState, useEffect } from 'react'
import { useBuild } from '@/contexts/build-context'
import { useRealPreview } from '@/lib/build/useRealPreview'

export function Preview() {
  const { state, dispatch } = useBuild()
  // Kick real generation once the user reaches the preview view with an idea.
  const { previewUrl, status, chatId } = useRealPreview(state.idea, state.view === 'preview' && !!state.idea)
  const [copied, setCopied] = useState(false)

  // Once the app is ready, register slug → chatId so /build/{slug} resolves to it,
  // and store the chatId in state so the Live dashboard can link the real app. (FIX-2)
  useEffect(() => {
    if (status !== 'ready' || !chatId || !state.appSub) return
    dispatch({ type: 'SET_APP_CHATID', chatId })
    fetch('/api/build/register-app', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: state.appSub, chatId, name: state.companyName,
        tagline: state.brandTagline, color: state.brandColor, track: state.track,
      }),
    }).catch(() => {})
  }, [status, chatId, state.appSub])

  // The real, shareable subdirectory URL (no DNS, works immediately). (FIX-2)
  const shareUrl = chatId && status === 'ready' && state.appSub
    ? (typeof window !== 'undefined' ? `${window.location.origin}/build/${state.appSub}` : `/build/${state.appSub}`)
    : null

  const copyShare = () => {
    if (!shareUrl) return
    navigator.clipboard?.writeText(shareUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }).catch(() => {})
  }

  const liveLabel =
    status === 'ready' ? 'Live in production'
    : status === 'error' ? 'Preview unavailable'
    : 'Building your app…'

  return (
    <>
      <div className="m-live-chip m-mono">
        <span className="m-live-dot" /> {liveLabel}
      </div>

      {shareUrl && (
        <div className="m-share-bar">
          <span className="m-mono m-share-label">Shareable link</span>
          <a className="m-mono m-share-url" href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a>
          <button className="btn-secondary m-share-copy" onClick={copyShare}>{copied ? '✓ Copied' : 'Copy'}</button>
        </div>
      )}

      {state.builtMVP && (
        <div className="m-cody-banner">
          <p><span className="m-glyph">◇</span> Your MVP is live in the sandbox. Ready to put it in front of real users and build the company?</p>
          <button className="btn-primary" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'pricing' })}>Make it real →</button>
        </div>
      )}

      <div className="m-browser">
        <div className="m-browser-chrome m-mono">
          <span className="m-browser-dots"><i /><i /><i /></span>
          <span className="m-browser-url">{state.appSub || 'your-app'}.ainative.studio</span>
        </div>
        <div className="m-browser-body">
          {previewUrl ? (
            <iframe
              key={previewUrl}
              src={previewUrl}
              className="m-preview-frame"
              title="Your generated app"
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
            />
          ) : status === 'error' ? (
            <div className="m-preview-fallback">
              <p className="m-mono">Cody couldn&apos;t build the live preview this time.</p>
              <p className="m-sub">Your artifacts are all here — the app build can be retried.</p>
            </div>
          ) : (
            <div className="m-preview-fallback">
              <p className="m-mono"><span className="m-live-dot" /> Cody is building your app…</p>
              <div className="m-preview-skel">
                {[92, 70, 84, 60].map((w, i) => <div key={i} className="m-shimmer m-gen-line" style={{ width: `${w}%` }} />)}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
