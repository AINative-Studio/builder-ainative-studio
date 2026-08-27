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

import { useState, useEffect, useMemo } from 'react'
import { useBuild } from '@/contexts/build-context'
import { useRealPreview } from '@/lib/build/useRealPreview'
import { shouldUseSandpack } from '@/lib/build/preview-engine'
import { FeedbackPulse } from '@/components/build/FeedbackPulse'
import {
  shouldShowMvpUpsell,
  defaultSprintEstimate,
  sprintCostLine,
  buildsRemainingLine,
} from '@/lib/build/value-moment'
import dynamic from 'next/dynamic'

// The recommended plan the sprint cost line is expressed against (#320) — the
// featured tier from the pricing screen; its 1M-token allowance is published in
// lib/build/value-moment.ts PLAN_TOKEN_ALLOWANCES.
const RECOMMENDED_PLAN = { id: 'pro', name: 'Pro' }

// Sandpack is a heavy client-only bundle (esbuild worker). Load it lazily so it's
// code-split out of the common single-file path (Babel iframe) — only pulled when a
// genuinely multi-file app actually needs it (#291).
const SandpackPreview = dynamic(
  () => import('@/components/chat/sandpack-preview').then((m) => m.SandpackPreview),
  { ssr: false, loading: () => (
    <div className="m-preview-fallback">
      <p className="m-mono"><span className="m-live-dot" /> Loading multi-file preview…</p>
    </div>
  ) },
)

export function Preview() {
  const { state, dispatch } = useBuild()
  // Kick real generation once the user reaches the preview view with an idea.
  const { previewUrl, status, chatId, files } = useRealPreview(state.idea, state.view === 'preview' && !!state.idea)
  // Engine routing (#291): a genuinely multi-file app renders via Sandpack (real
  // bundler, resolves cross-file imports); single-file apps keep the hardened Babel
  // iframe. Only route to Sandpack once the app is READY and the payload qualifies.
  const useSandpack = status === 'ready' && shouldUseSandpack(files)
  const [copied, setCopied] = useState(false)
  // #213: the durable live URL returned by register-app (deployPersistent) — a real
  // {slug}.ainative.studio wildcard host when configured, else the /build/{slug}
  // preview. Auto-deploying the app-track app to a real shareable URL is the goal.
  const [deployUrl, setDeployUrl] = useState<string | null>(null)
  // Real build-credit status (#320) — read from GET /api/build/credits so the
  // upsell's "X of N free builds" figure is never fabricated. Null until loaded.
  const [credits, setCredits] = useState<{ used: number; limit: number; unlimited: boolean } | null>(null)

  // Value moment (#310/#311 GR-01/GR-02): the founder is LOOKING at a working
  // preview. Mark it in state (gates pricing routing + honest framing) and
  // report it server-side (satisfies the free tier's one-visible-build
  // guarantee — after this, the normal build limit applies). Best-effort.
  useEffect(() => {
    if (status !== 'ready' || state.sawPreview) return
    dispatch({ type: 'SAW_PREVIEW' })
    fetch('/api/build/credits', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'preview_reached', slug: state.appSub }),
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // MVP-first upsell (#320 GR-11): once the working MVP is visible, fetch the
  // REAL credit status so the offer shows honest remaining-build numbers.
  const showUpsell = shouldShowMvpUpsell({ builtMVP: state.builtMVP, previewStatus: status })
  useEffect(() => {
    if (!showUpsell || credits) return
    fetch('/api/build/credits')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.used === 'number') {
          setCredits({ used: d.used, limit: d.limit, unlimited: !!d.unlimited })
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showUpsell])

  // The explicit sprint cost (#320): no per-sprint cost exists server-side, so
  // this is computed from the REAL generation-pipeline caps and labeled as an
  // estimate (see lib/build/value-moment.ts). Deterministic — memo once.
  const sprintLine = useMemo(() => sprintCostLine(defaultSprintEstimate(), RECOMMENDED_PLAN), [])
  const remainingLine = buildsRemainingLine(credits)

  // Once the app is ready, register slug → chatId so /build/{slug} resolves to it,
  // and store the chatId in state so the Live dashboard can link the real app. (FIX-2)
  // register-app also resolves + persists the durable live URL (#213) and returns it.
  useEffect(() => {
    if (status !== 'ready' || !chatId || !state.appSub) return
    dispatch({ type: 'SET_APP_CHATID', chatId })
    fetch('/api/build/register-app', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: state.appSub, chatId, name: state.companyName,
        tagline: state.brandTagline, color: state.brandColor, track: state.track,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.deployUrl) setDeployUrl(String(d.deployUrl)) })
      .catch(() => {})
  }, [status, chatId, state.appSub])

  // Product rule (#78): the {slug}.ainative.studio subdomain must NOT be surfaced
  // until the company is on a PAID plan AND has explicitly CLAIMED the subdomain — and
  // it does NOT resolve until then (the middleware 301s it to the path). This
  // artifact preview is the PRE-PAID surface (shown before any upgrade/claim), so it
  // must always share and display the durable /build/{slug} PATH form, never the
  // subdomain. The claimed subdomain is surfaced on Live once paid+claimed. The
  // persisted deployUrl (which may be a wildcard host) is intentionally not used here.
  void deployUrl

  // Security: the preview iframe is sandboxed WITHOUT allow-same-origin, so the
  // generated (LLM-authored) app runs on a null origin and cannot script this
  // parent, read our cookies, or reach same-origin APIs. The scaffold error
  // pages inside the frame therefore can't call window.parent.location directly
  // anymore — they postMessage a nav request instead, which we honor here after
  // validating the origin is null (a sandboxed frame) and the payload shape.
  useEffect(() => {
    function onPreviewMessage(e: MessageEvent) {
      // A sandboxed (no allow-same-origin) iframe posts with origin "null".
      if (e.origin !== 'null') return
      const data = e.data as { type?: string; action?: string } | null
      if (!data || data.type !== 'ainative-preview-nav') return
      if (data.action === 'home') {
        window.location.href = '/'
      } else if (data.action === 'regenerate') {
        // A failed-build error page asked to REBUILD the app (#310). Re-run the SAME
        // idea through generation (START_BUILD) instead of dead-ending the customer
        // on the homepage. With the stronger model now default, the retry usually
        // succeeds. Falls back to a reload if there's no idea to rebuild.
        if (state.idea && state.appSub) {
          dispatch({ type: 'START_BUILD', idea: state.idea, appSub: state.appSub, companyName: state.companyName })
          dispatch({ type: 'GOTO_VIEW', view: 'preview' as import('@/lib/build/state').ArtifactView })
        } else {
          window.location.reload()
        }
      } else if (data.action === 'retry' || data.action === 'reload') {
        window.location.reload()
      }
    }
    window.addEventListener('message', onPreviewMessage)
    return () => window.removeEventListener('message', onPreviewMessage)
  }, [state.idea, state.appSub, state.companyName, dispatch])

  // The real, shareable URL: the durable /build/{slug} subdirectory (works
  // immediately, no DNS, resolves for anyone). (FIX-2 / #213 / #78)
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

      {/* MVP-first upsell (#320 GR-11): the working MVP is the value moment —
          only THEN present the deeper build-out with an explicit, honest cost.
          Shown strictly after the preview has rendered (never over a skeleton). */}
      {showUpsell && (
        <div className="m-cody-banner" data-testid="mvp-upsell">
          <p>
            <span className="m-glyph">◇</span> Your MVP works — you&apos;re looking at it.
            Want the full build-out? The deeper PRD, sprint plan, and the business systems
            around your app are one sprint. {sprintLine}{remainingLine ? ` ${remainingLine}` : ''}
          </p>
          <button className="btn-primary" data-testid="mvp-upsell-cta" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'pricing' })}>See the sprint offer →</button>
        </div>
      )}
      {/* Fallback for the completed-MVP state when the preview frame itself
          couldn't render (error): keep the original forward path, no cost claim
          — we don't pitch a sprint over a preview the founder can't see. */}
      {state.builtMVP && !showUpsell && (
        <div className="m-cody-banner">
          <p><span className="m-glyph">◇</span> Your MVP is live in the sandbox. Ready to put it in front of real users and build the company?</p>
          <button className="btn-primary" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'pricing' })}>Make it real →</button>
        </div>
      )}

      <div className="m-browser">
        <div className="m-browser-chrome m-mono">
          <span className="m-browser-dots"><i /><i /><i /></span>
          <span className="m-browser-url">{`builder.ainative.studio/build/${state.appSub || 'your-app'}`}</span>
        </div>
        <div className="m-browser-body">
          {useSandpack && files ? (
            // Multi-file app → Sandpack (real bundler + cross-file import resolution).
            // Sandpack runs in its own CodeSandbox sandbox origin (isolated by
            // construction), so it doesn't need our iframe sandbox attrs. (#291)
            <div className="m-preview-frame" style={{ height: '100%' }} data-testid="sandpack-preview-mount">
              <SandpackPreview files={files} />
            </div>
          ) : previewUrl ? (
            <iframe
              key={previewUrl}
              // #331: pass the slug so the preview route can mint + inject this
              // app's data token (scoping /api/db to its own ZeroDB project).
              src={state.appSub ? `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}slug=${encodeURIComponent(state.appSub)}` : previewUrl}
              className="m-preview-frame"
              title="Your generated app"
              // Security (#9/#10): NO allow-same-origin — the generated LLM-authored
              // app runs on a null origin, isolated from our cookies/DOM/APIs. It can
              // still run scripts, submit forms, open modals/popups. Nav requests from
              // the scaffold error pages arrive via postMessage (see onPreviewMessage).
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
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

      {/* RLHF pulse (#332): one-tap signal on the generation, right at the value
          moment — the app just rendered. Once per generation, never blocking. */}
      {status === 'ready' && <FeedbackPulse surface="preview" chatId={chatId || undefined} />}
    </>
  )
}
