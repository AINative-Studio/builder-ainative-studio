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
 *
 * #866 (2026-09-24): two more real gaps found on this same page, both
 * confirmed live against a real founder's (evan@ainative.studio) permanently-
 * broken generation (#865):
 *
 *  1. The "Preview Unavailable" error page's OWN "Start New Chat" button
 *     posts `{ action: 'home' }`, which this listener sent to the bare
 *     marketing homepage (`/`) — no `?company=` at all. That's the ONLY
 *     button on that error page (the other is "Try Again" → reload, which
 *     just re-shows the same error), so a founder whose generation is
 *     genuinely, permanently broken had NO way back into the real dashboard
 *     from here. Fixed: 'home' now goes to this company's own Live dashboard
 *     (`/build?screen=live&company={slug}`) when a slug is known, falling
 *     back to `/` only when it genuinely isn't.
 *
 *  2. This page never calls `/api/build/subscription/status`, which is the
 *     ONLY place `reconcilePlanFulfillment()` runs (from `Live.tsx` on
 *     mount) — the self-heal that fixes a stale `plan: null` / `tmp` key
 *     registry entry against a founder's real, current paid plan. A founder
 *     who only ever uses their standalone share link (never opens the full
 *     dashboard) got no self-heal, no matter how many times they reloaded or
 *     re-logged-in — confirmed live: evan's registry stayed stale through a
 *     real logout/login specifically because of this gap. Fixed: this page
 *     now makes that same call once on mount when the founder is signed in,
 *     so reconciliation isn't gated on finding the dashboard first.
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

/**
 * Where "Start New Chat" / "home" should actually send the founder: back to
 * THIS company's own Live dashboard when a slug is known (that's where
 * regeneration, plan reconciliation, and everything else actually lives),
 * falling back to the bare homepage only when there's genuinely no slug to
 * route with. Pure + exported so the routing decision is unit-testable.
 */
export function homeDestination(slug?: string): string {
  const s = (slug || '').trim()
  return s ? `/build?screen=live&company=${encodeURIComponent(baseSlugOf(s))}` : '/'
}

export function StandalonePreviewRegenerate({ slug, idea, track, name }: RegenerateProps) {
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')

  // #866: the ONLY place reconcilePlanFulfillment() runs is Live.tsx's own
  // mount effect — a founder who never leaves this standalone page never
  // gets that self-heal. Fire the same status check here once, best-effort;
  // a 401 (signed out) or any failure is silently ignored, same as every
  // other best-effort call on this page.
  useEffect(() => {
    if (!slug) return
    fetch(`/api/build/subscription/status?slug=${encodeURIComponent(baseSlugOf(slug))}`).catch(() => {})
  }, [slug])

  useEffect(() => {
    function onPreviewMessage(e: MessageEvent) {
      if (!isAcceptedPreviewMessageOrigin(e.origin, window.location.origin)) return
      const data = e.data as { type?: string; action?: string } | null
      if (!data || data.type !== 'ainative-preview-nav') return
      if (data.action === 'home') {
        window.location.href = homeDestination(slug)
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
