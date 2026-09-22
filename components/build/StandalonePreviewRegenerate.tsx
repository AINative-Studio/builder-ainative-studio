'use client'

import { useEffect, useState } from 'react'

/**
 * Real gap found live (2026-09-21): a founder's real product build
 * (/build/{slug}-product) can fail server-side code validation (e.g.
 * "Identifier 'X' has already been declared") and correctly serve an honest
 * "This build needs another pass" error page with a real "Regenerate this
 * app" button — but that button posts { type:'ainative-preview-nav',
 * action:'regenerate' } to window.parent, and NOTHING was listening: the
 * standalone /build/{slug} page (opened via "Open your product →" in a new
 * tab, or any shared link) is a plain server component with no chat/reducer
 * context and no message listener at all. Clicking it did nothing.
 *
 * This wires up that listener for the standalone page specifically. Only the
 * Company track has a real, headless REST endpoint that can regenerate
 * without a live chat/reducer session (company-app / company-product,
 * `force: true` bypasses their own "already built" cache so a genuinely
 * failed generation can actually be retried — see those routes' own doc
 * comments). The App track's real generation path runs through the full
 * chat-ws/reducer flow inside the dashboard (Preview.tsx already has a
 * working regenerate handler for that, #310) — there's no headless
 * equivalent to call from a bare standalone page, so for that track this
 * honestly sends the founder back into the dashboard to regenerate from
 * there, rather than silently doing nothing.
 */
export interface RegenerateProps {
  slug: string
  idea?: string
  track?: string
  name?: string
}

/** A slug's base (non "-product"-suffixed) form. */
export function baseSlugOf(slug: string): string {
  return slug.endsWith('-product') ? slug.slice(0, -'-product'.length) : slug
}

/**
 * Pure decision for a real "regenerate" click: does this track/state have a
 * headless REST path that can actually retry generation, or must the founder
 * be sent back into the real dashboard (the App track's only working
 * regenerate path runs through the full chat-ws/reducer flow inside Preview.tsx,
 * #310 — there's no headless equivalent to call from a bare standalone page)?
 * Exported so the real decision (which endpoint, what body, or which redirect)
 * is unit-testable without mounting the component or touching window.location.
 */
export function planRegenerate(props: RegenerateProps):
  | { kind: 'redirect'; url: string }
  | { kind: 'call'; endpoint: string; body: { idea: string; slug: string; name: string; force: true } } {
  const baseSlug = baseSlugOf(props.slug)
  if (props.track !== 'company' || !props.idea) {
    return { kind: 'redirect', url: `/build?screen=live&company=${encodeURIComponent(baseSlug)}` }
  }
  const isProduct = props.slug.endsWith('-product')
  return {
    kind: 'call',
    endpoint: isProduct ? '/api/build/company-product' : '/api/build/company-app',
    body: { idea: props.idea, slug: baseSlug, name: props.name || baseSlug, force: true },
  }
}

/**
 * Real bug fixed live (confirmed via a real Playwright click, not just an
 * API-level check): `Preview.tsx`'s iframe (the in-dashboard preview) is
 * sandboxed WITHOUT allow-same-origin, so it posts with origin "null" —
 * that's the pattern this check originally, wrongly, assumed applied
 * everywhere. But the STANDALONE page's own iframe explicitly DOES include
 * allow-same-origin (see app/build/[slug]/page.tsx), so it posts with the
 * real page origin instead. A human clicking "Regenerate" saw the button's
 * own inline script correctly flip its text to "Rebuilding…", but nothing
 * else ever happened — this check silently discarded the real message on
 * every single click. Exported so this exact regression is unit-testable
 * without mounting the component or faking a MessageEvent.
 */
export function isAcceptedPreviewMessageOrigin(messageOrigin: string, pageOrigin: string): boolean {
  return messageOrigin === 'null' || messageOrigin === pageOrigin
}

export function StandalonePreviewRegenerate({ slug, idea, track, name }: RegenerateProps) {
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')

  useEffect(() => {
    function onPreviewMessage(e: MessageEvent) {
      if (!isAcceptedPreviewMessageOrigin(e.origin, window.location.origin)) return
      const data = e.data as { type?: string; action?: string } | null
      if (!data || data.type !== 'ainative-preview-nav') return
      if (data.action === 'home') {
        window.location.href = '/'
        return
      }
      if (data.action === 'retry' || data.action === 'reload') {
        window.location.reload()
        return
      }
      if (data.action !== 'regenerate') return

      const plan = planRegenerate({ slug, idea, track, name })
      if (plan.kind === 'redirect') {
        window.location.href = plan.url
        return
      }

      setStatus('working')
      fetch(plan.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plan.body),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.chatId || d?.status === 'processing' || d?.status === 'recovered') {
            // A fresh background generation was kicked off (or already
            // resolved) — reload to pick up the new attempt once it lands.
            // The preview iframe itself will keep showing the prior error
            // page until this slug re-resolves to validated code; a plain
            // reload after a short delay gives the common fast-fail/retry
            // case a chance to land without the founder needing to act again.
            setStatus('done')
            setTimeout(() => window.location.reload(), 4000)
          } else {
            setStatus('error')
          }
        })
        .catch(() => setStatus('error'))
    }
    window.addEventListener('message', onPreviewMessage)
    return () => window.removeEventListener('message', onPreviewMessage)
  }, [slug, idea, track, name])

  if (status === 'working') {
    return (
      <div
        role="status"
        style={{
          position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          background: '#151312', color: '#fff', padding: '10px 18px', borderRadius: 8,
          fontFamily: 'ui-monospace, monospace', fontSize: 13, zIndex: 50,
        }}
      >
        Rebuilding {slug}…
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div
        role="status"
        style={{
          position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          background: '#7a1f1f', color: '#fff', padding: '10px 18px', borderRadius: 8,
          fontFamily: 'ui-monospace, monospace', fontSize: 13, zIndex: 50,
        }}
      >
        Couldn&apos;t start a rebuild — refresh and try again.
      </div>
    )
  }
  return null
}
