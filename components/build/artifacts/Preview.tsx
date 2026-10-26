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

import { useState, useEffect, useMemo, useRef } from 'react'
import { useBuild } from '@/contexts/build-context'
import { useRealPreview, type DesignConformanceSummary } from '@/lib/build/useRealPreview'
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

type PreviewStatus = 'idle' | 'generating' | 'ready' | 'error'

/**
 * Pure decision: the "Live in production" chip's real label. Real bug fix —
 * a build can render fine client-side (status:'ready') while the SERVER'S
 * pre-deploy parse gate rejects registering it (a real syntax error caught by
 * a stricter check), and the founder deserves to know that's still resolving
 * rather than seeing a confident "Live in production" claim. See the
 * register-app effect in Preview() for the full incident + evidence.
 *
 * builder#1256: `registered === null` (the register-app POST is in flight —
 * it resolves + persists a durable deploy URL, so it's a real network round
 * trip, not instant) used to ALSO show "Live in production", on the
 * reasoning that it's "not yet known to be broken." That's the wrong default
 * for a claim this specific: a real, reproduced incident showed a company's
 * OWN workspace confidently claiming "Live in production" with a rendered
 * chat UI, while `/api/build/my-companies` never listed it (no registry row
 * existed yet) AND the standalone `/build/{slug}` URL — which resolves
 * through that same registry — showed "This preview is still being built."
 * Two surfaces disagreeing about the same company, because this chip
 * promised a state the registry hadn't reached. Honest instead: a distinct
 * in-between label for the genuinely-pending window, reserving "Live in
 * production" for registered:true the same way the share-URL link below
 * already does (shouldShowShareUrl has required registered===true since the
 * original #77 fix — this chip was the one surface that never followed).
 */
export function livePreviewLabel(status: PreviewStatus, registered: boolean | null): string {
  if (status === 'ready' && registered === false) return 'Fixing a generation error…'
  if (status === 'ready' && registered === null) return 'Finishing up…'
  if (status === 'ready') return 'Live in production'
  if (status === 'error') return 'Preview unavailable'
  return 'Building your app…'
}

/**
 * Real finding (#1255, live verification — two full builds, "Morphic" and
 * "Fluent"): the terminal ribbon's deploy narration (RIBBON_LINES.preview in
 * useAutoplay.ts) is a short, fully scripted sequence — 4 fixed lines on fixed
 * timers that total ~3.4s — written to cover the provision+deploy SCAFFOLDING
 * around generation, not the actual code-generation call itself. It always
 * ends on "deploy ▸ live at staging" and never advances again, even though
 * real generation (useRealPreview → /api/chat-ws) is very often still running
 * well behind it — this is the longest wait in the whole pipeline and the
 * ribbon has nothing scripted left to say about it. A founder watching that
 * log genuinely cannot tell "almost done" from "hung forever."
 *
 * There IS a real backend signal during generation: useRealPreview's SSE
 * stream bumps refreshKey on every genuine chat-ws 'files'/'refresh' event.
 * This function turns that real signal (plus elapsed time, for the quiet
 * stretches between events) into an honest ribbon line, so the log keeps
 * narrating genuine activity for the real generation duration instead of
 * sitting frozen on stale deploy scaffolding. Returns null when there's
 * nothing new to say (not generating, or no real signal has changed/elapsed
 * enough yet) — callers must not append a line in that case.
 */
export function generationRibbonLine(
  status: PreviewStatus,
  refreshKey: number,
  lastSeenRefreshKey: number,
  msSinceLastLine: number,
  heartbeatMs = 4000,
): string | null {
  if (status !== 'generating') return null
  if (refreshKey > lastSeenRefreshKey) return 'generate ▸ writing app code…'
  if (msSinceLastLine >= heartbeatMs) return 'generate ▸ still working — this can take a few minutes'
  return null
}

/**
 * Pure decision: the skeleton-loader sub-line under "Cody is building your
 * app…" (#1255). The reporter's fallback suggestion — a distinct, honest
 * "still generating" state once the wait has gone on long enough that
 * silence alone would read as stalled, separate from the terminal ribbon so
 * the ribbon's own staleness (see generationRibbonLine above) doesn't compound
 * it. Returns null before the threshold — the plain "building…" line alone is
 * accurate and doesn't need qualifying yet.
 */
export function stillGeneratingLine(elapsedMs: number, thresholdMs = 15_000): string | null {
  if (elapsedMs < thresholdMs) return null
  return 'Still generating your app — this can take several minutes for a complex build.'
}

/**
 * Pure decision: should the shareable /build/{slug} URL be shown at all?
 * Gated on `registered === true` (not just status:'ready') — showing this
 * link before the registry actually confirms the row exists means the
 * founder copies/shares a URL that 404s forever (real, live bug found via E2E
 * verification against production: register-app's 422 rejection was silently
 * discarded, the UI never reflected it).
 */
export function shouldShowShareUrl(chatId: string | null | undefined, registered: boolean | null, appSub: string | null | undefined): boolean {
  return Boolean(chatId) && registered === true && Boolean(appSub)
}

/**
 * Design conformance badge label (#751) — the real post-generation check
 * result (lib/build/design-conformance.ts, surfaced live over the chat-ws SSE
 * 'complete' event via useRealPreview) rendered as a short, founder-legible
 * label. Returns null when there's nothing to show (no design system was
 * explicitly chosen, or the app isn't ready yet) so the caller renders
 * nothing rather than a confusing badge before there's a real result.
 */
export function designConformanceLabel(
  status: PreviewStatus,
  conformance: DesignConformanceSummary | null | undefined,
): string | null {
  if (status !== 'ready' || !conformance) return null
  if (conformance.status === 'pass') return 'Matches your design system'
  if (conformance.status === 'partial') return 'Partially matches your design system'
  return "Doesn't match your design system"
}

export function Preview() {
  const { state, dispatch } = useBuild()
  // Kick real generation once the user reaches the preview view with an idea.
  // #532: pass through the founder's already-reviewed dataModel artifact (when
  // generation succeeded — undefined otherwise) so the real generated app's
  // schema stays consistent with the document Cody showed them earlier in the
  // build. dataModel is generated well before preview in APP_VIEWS order, so
  // it's already in state.generated by the time this mounts.
  const { previewUrl, status, chatId, files, designConformance, refreshKey } = useRealPreview(
    state.idea,
    state.view === 'preview' && !!state.idea,
    state.generated?.dataModel,
    state.designSystemId,
  )

  // #1255: keep the terminal ribbon narrating REAL generation activity for as
  // long as generation actually runs, instead of leaving it frozen on
  // useAutoplay's scripted "deploy ▸ live at staging" — the ribbon's own
  // script legitimately has nothing left to say once that line fires, but the
  // real /api/chat-ws call behind this view is very often still in flight.
  // Each genuine SSE 'files'/'refresh' event bumps refreshKey (a real signal);
  // a quiet stretch between events still gets an honest heartbeat line so the
  // log never again reads as stalled during the single longest wait in the
  // pipeline. Pure decision lives in generationRibbonLine (above) — a single
  // interval (started once per "generating" run, not recreated on every
  // refreshKey bump) polls the latest status/refreshKey via refs and
  // dispatches whenever there's something real to say.
  const statusRef = useRef(status)
  const refreshKeyRef = useRef(refreshKey)
  statusRef.current = status
  refreshKeyRef.current = refreshKey
  // How long the CURRENT "generating" run has been going — drives both the
  // ribbon heartbeat above and the skeleton's own "still generating" sub-line
  // below (#1255). Starts fresh each time generation (re)enters 'generating'.
  const [generatingElapsedMs, setGeneratingElapsedMs] = useState(0)
  useEffect(() => {
    if (status !== 'generating') { setGeneratingElapsedMs(0); return }
    const startedAt = Date.now()
    let lastSeenRefreshKey = refreshKeyRef.current
    let lastLineAt = startedAt
    const id = setInterval(() => {
      setGeneratingElapsedMs(Date.now() - startedAt)
      const line = generationRibbonLine(
        statusRef.current, refreshKeyRef.current, lastSeenRefreshKey, Date.now() - lastLineAt,
      )
      if (line) {
        dispatch({ type: 'RIBBON', line })
        lastSeenRefreshKey = refreshKeyRef.current
        lastLineAt = Date.now()
      }
    }, 1000)
    return () => clearInterval(id)
    // Intentionally keyed on `status` alone — refreshKey changes are read via
    // the ref inside the interval, not re-triggering effect teardown/setup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])
  // Engine routing (#291): a genuinely multi-file app renders via Sandpack (real
  // bundler, resolves cross-file imports); single-file apps keep the hardened Babel
  // iframe. Only route to Sandpack once the app is READY and the payload qualifies.
  //
  // Resilience (found live, same session): Sandpack's bundler-side dependency
  // fetch can hang forever with no error (unfixed CodeSandbox/unpkg gap — see
  // components/chat/sandpack-preview.tsx's doc comment). sandpackTimedOut
  // falls this back to previewUrl's iframe if Sandpack hasn't finished within
  // 15s — a founder actively waiting on their own build deserves to see
  // SOMETHING rather than a permanently blank sandbox.
  const [sandpackTimedOut, setSandpackTimedOut] = useState(false)
  const useSandpack = status === 'ready' && shouldUseSandpack(files) && !sandpackTimedOut
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
  //
  // Real, live bug found via E2E verification (#563 follow-up): register-app has
  // a real pre-deploy parse gate (builder#77) that can reject a build that LOOKS
  // ready client-side (status==='ready', the iframe rendered) but fails a
  // stricter server-side re-check (e.g. a syntax error the flattened parse
  // catches). That rejection is a real 422 with `retry:true` — but this effect
  // used to discard it entirely (`r.ok ? r.json() : null` resolves to `null` on
  // a non-2xx, and the `.then` callback did nothing with it). The founder saw a
  // confident "Live in production" chip and a copyable shareable link that
  // 404'd forever, because the registry never actually got a row. `registered`
  // now tracks the real outcome so the UI can stop claiming a URL exists when
  // the server just refused to create it.
  const [registered, setRegistered] = useState<boolean | null>(null)
  // #1551: a single repair+retry cycle wasn't always enough — an LLM repair
  // attempt can itself fail to fix the real syntax error on the first try,
  // same as chat-ws's own in-request retries assume. retryKey is bumped only
  // by the user's explicit "Try again" click below; it is NOT part of the
  // bounded in-effect repair loop, which tracks its own attempt count locally
  // so this effect still runs exactly once per real registration attempt.
  const [retryKey, setRetryKey] = useState(0)
  const [repairing, setRepairing] = useState(false)
  const MAX_REPAIR_ATTEMPTS = 3
  useEffect(() => {
    if (status !== 'ready' || !chatId || !state.appSub) return
    dispatch({ type: 'SET_APP_CHATID', chatId })

    const registerBody = JSON.stringify({
      slug: state.appSub, chatId, name: state.companyName,
      tagline: state.brandTagline, color: state.brandColor, track: state.track,
      idea: state.idea,
    })
    const tryRegister = () =>
      fetch('/api/build/register-app', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: registerBody,
      }).then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => null) }))

    let cancelled = false
    const adopt = (d: any) => {
      if (d?.deployUrl) setDeployUrl(String(d.deployUrl))
      // The requested slug collided with a DIFFERENT founder's existing build
      // and got auto-suffixed server-side (register-app's firstFreeSlug) —
      // adopt the real, actually-registered slug so /build/{slug} and every
      // subsequent call use it, not the one that lost the naming collision.
      if (d?.slugChanged) dispatch({ type: 'RESTORE_BUILD', partial: { appSub: String(d.slugChanged) } })
    }

    setRepairing(false)
    const attempt = async (repairAttemptsLeft: number): Promise<void> => {
      const { ok, d } = await tryRegister().catch(() => ({ ok: false, d: null as any }))
      if (cancelled) return
      if (ok) { setRegistered(true); setRepairing(false); adopt(d); return }

      // Real bug fix (follow-up to the `registered` tri-state above): a 422
      // here carries `retry:true` + the exact parse error — computed
      // server-side but, until now, NEVER actually consumed by anything.
      // The founder was stuck forever on a genuinely broken build with no
      // path forward except starting over. Actually consume it: call the
      // repair endpoint (re-generates the STORED broken code with the real
      // error fed back — the same repair loop chat-ws uses for its own
      // in-request retries, see app/api/build/repair-app). #1551: one repair
      // attempt isn't always enough, so retry the repair+register cycle up
      // to MAX_REPAIR_ATTEMPTS times before giving up — a single stubborn
      // LLM repair miss shouldn't permanently strand the founder.
      if (d?.retry && d?.error && repairAttemptsLeft > 0) {
        setRepairing(true)
        const repaired = await fetch('/api/build/repair-app', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId, error: d.error }),
        }).then((r) => r.json()).catch(() => null)
        if (cancelled) return
        if (repaired?.recovered) {
          return attempt(repairAttemptsLeft - 1)
        }
        // Repair call succeeded but didn't fix it (or errored) — the cap
        // isn't exhausted on a transient repair-call failure, so still
        // consume one attempt and try the cycle again.
        return attempt(repairAttemptsLeft - 1)
      }
      setRepairing(false)
      setRegistered(false)
    }

    attempt(MAX_REPAIR_ATTEMPTS)

    return () => { cancelled = true }
  }, [status, chatId, state.appSub, retryKey])

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
  const shareUrl = shouldShowShareUrl(chatId, registered, state.appSub)
    ? (typeof window !== 'undefined' ? `${window.location.origin}/build/${state.appSub}` : `/build/${state.appSub}`)
    : null

  const copyShare = () => {
    if (!shareUrl) return
    navigator.clipboard?.writeText(shareUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }).catch(() => {})
  }

  const liveLabel = livePreviewLabel(status, registered)
  const conformanceLabel = designConformanceLabel(status, designConformance)

  return (
    <>
      <div className="m-live-chip m-mono">
        <span className="m-live-dot" /> {liveLabel}
      </div>

      {/* Design system conformance (#751): a real, founder-visible signal that
          the generated app actually used the chosen design system's colors —
          not just a value checked and silently logged server-side. Only
          rendered once the app is ready and a system was explicitly chosen. */}
      {conformanceLabel && (
        <div
          className="m-mono"
          data-testid="design-conformance-badge"
          data-status={designConformance?.status}
          title={conformanceLabel}
        >
          {designConformance?.status === 'pass' ? '✓' : designConformance?.status === 'partial' ? '~' : '✗'} {conformanceLabel}
        </div>
      )}

      {shareUrl && (
        <div className="m-share-bar">
          <span className="m-mono m-share-label">Shareable link</span>
          <a className="m-mono m-share-url" href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a>
          <button className="btn-secondary m-share-copy" onClick={copyShare}>{copied ? '✓ Copied' : 'Copy'}</button>
        </div>
      )}

      {/* Real bug found via E2E verification: register-app's pre-deploy parse
          gate rejected this build (a real syntax error), but the UI used to
          keep showing "Live in production" + a copyable link that 404s
          forever — the founder had no idea anything was wrong. Honest instead:
          say so, and never render the share bar above until registered:true.
          #1551: the repair+retry cycle (above) is now bounded but can still
          exhaust its attempts — once it does, `repairing` is back to false
          and this must stop claiming an active repair is underway, offering
          a real "Try again" button instead of a permanently stale message. */}
      {status === 'ready' && registered === false && (
        <div className="m-cody-banner" data-testid="register-failed-banner">
          {repairing ? (
            <p>
              <span className="m-glyph">◇</span> Cody hit a generation error while finishing your app and is
              repairing it — the preview below is real, but the shareable link isn&apos;t ready yet.
            </p>
          ) : (
            <p>
              <span className="m-glyph">◇</span> Cody couldn&apos;t finish repairing a generation error in your
              app. The preview below is real, but the shareable link isn&apos;t ready yet.{' '}
              <button
                className="btn-secondary"
                data-testid="register-retry-button"
                onClick={() => { setRegistered(null); setRetryKey((k) => k + 1) }}
              >
                Try again
              </button>
            </p>
          )}
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
          — we don't pitch a sprint over a preview the founder can't see.
          CRITICAL GATE: never while status==='generating' — builtMVP flips when
          the ARTIFACT sequence completes, which is before the real app build
          finishes, so this banner used to surface mid-generation; clicking it
          navigated to Pricing, unmounted this component, and ABORTED the
          in-flight generation (useRealPreview cleanup). Make-it-real only
          exists once generation has actually settled (ready → upsell above;
          error → this fallback). */}
      {state.builtMVP && !showUpsell && status === 'error' && (
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
              <SandpackPreview files={files} timeoutMs={15000} onTimeout={() => setSandpackTimedOut(true)} />
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
              {/* #1255: once the wait has gone on long enough that silence alone
                  would read as stalled, say so honestly — distinct from (and not
                  dependent on) the terminal ribbon above, so this surface doesn't
                  inherit the ribbon's own staleness problem. */}
              {stillGeneratingLine(generatingElapsedMs) && (
                <p className="m-sub" data-testid="still-generating-line">{stillGeneratingLine(generatingElapsedMs)}</p>
              )}
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
