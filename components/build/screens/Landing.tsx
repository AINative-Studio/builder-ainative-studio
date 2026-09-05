'use client'

/**
 * Landing — the public marketing front door (Claude Design handoff:
 * "Landing & Signup"). A four-beat pinned-scroll ("scrollytelling") hero in the
 * Modernist system, shown to cold/logged-out visitors before the builder path.
 *
 * Beats (crossfaded by scroll progress over a 4×-viewport pinned stage):
 *   0. The Company That Builds Itself   (full-bleed grayscale photo + Get started)
 *   1. Never Start Alone                (light scrim, "Builder is employee one")
 *   2. Builder is your team.            (rule list of what Builder does)
 *   3. Build a company tonight.         (full-bleed red close-out + Get started)
 *
 * "Get started" enters the onboarding funnel (Start → Build → auth → builder).
 * Signed-in visitors never see this — BuildApp redirects them to their builds.
 */

import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useBuild } from '@/contexts/build-context'

const TICKER_LINES = [
  'Cody: Drafting your composition plan…',
  'Cody: Scaffolding your MVP…',
  'Cody: Wiring your pipeline…',
  'Cody: Reconciling your cap table…',
  'Cody: Fixing security holes…',
  'Cody: Ready when you are.',
]

const ArrowRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
  </svg>
)

/** Clamp a scroll-progress sub-segment to 0..1. */
function seg(p: number, start: number, end: number): number {
  if (p < start) return 0
  if (p > end) return 1
  return (p - start) / (end - start)
}

export function Landing() {
  const { dispatch } = useBuild()
  const { status } = useSession()
  const [progress, setProgress] = useState(0)
  const [tickerIdx, setTickerIdx] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)

  const startFlow = () => { window.scrollTo(0, 0); dispatch({ type: 'GOTO_SCREEN', screen: 'start' }) }
  // Signed-out → auth; signed-in → straight into their builds (My Builds). The
  // landing shows for everyone (founder direction) — this is the fast lane out.
  const goSignIn = () => { window.scrollTo(0, 0); dispatch({ type: 'GOTO_SCREEN', screen: 'login' }) }
  const openBuilder = () => { window.scrollTo(0, 0); dispatch({ type: 'GOTO_SCREEN', screen: 'companies' }) }

  // Scroll → progress. The stage is 4× viewport tall; progress maps the scroll
  // position within it to 0..1 (the prototype's 3.15 divisor keeps the last
  // beat fully settled before the stage ends).
  useEffect(() => {
    const onScroll = () => {
      const p = window.scrollY / (window.innerHeight * 3.15)
      setProgress(Math.max(0, Math.min(1, p)))
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Cody machine-speech ticker cycles independently of scroll.
  useEffect(() => {
    const t = setInterval(() => setTickerIdx((i) => (i + 1) % TICKER_LINES.length), 2600)
    return () => clearInterval(t)
  }, [])

  const p = progress
  const beat0 = 1 - seg(p, 0.03, 0.14)
  const beat1 = Math.max(0, seg(p, 0.03, 0.14) - seg(p, 0.36, 0.47))
  const beat2 = Math.max(0, seg(p, 0.36, 0.47) - seg(p, 0.69, 0.80))
  const beat3 = seg(p, 0.69, 0.80)

  return (
    <div className="modernist" style={{ minHeight: '100vh' }}>
      {/* machine-speech ticker */}
      <div className="m-land-ticker">&gt; {TICKER_LINES[tickerIdx]}<span className="m-caret">_</span></div>

      {/* top nav */}
      <div className="m-land-nav">
        <div className="m-land-title" style={{ fontSize: 22 }}>BUILDER</div>
        {status === 'authenticated' ? (
          <button onClick={openBuilder} className="m-land-signin" data-testid="landing-open-builder">Open Builder →</button>
        ) : (
          <button onClick={goSignIn} className="m-land-signin" data-testid="landing-signin">Sign in</button>
        )}
      </div>

      {/* pinned scrollytelling stage (4× viewport tall) */}
      <div ref={stageRef} className="m-land-stage" style={{ height: '400vh' }}>
        <div className="m-land-pin">

          {/* Beats crossfade by opacity but stay stacked in the DOM — a fully
              transparent layer must NOT swallow clicks meant for the visible one,
              so pointer-events tracks visibility. */}
          {/* beat 0 — hero */}
          <div className="m-land-beat" style={{ opacity: beat0, pointerEvents: beat0 > 0.5 ? 'auto' : 'none' }}>
            <img className="m-land-photo" alt=""
              src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600&q=60&auto=format" />
            <div className="m-land-scrim-dark" />
            <div className="m-land-beat-center" style={{ color: '#f3f2f2' }}>
              <h1 className="m-land-title" style={{ fontSize: 'clamp(38px,7vw,84px)', margin: '0 0 20px', maxWidth: '16ch' }}>
                The Company That Builds Itself
              </h1>
              <button onClick={startFlow} className="btn-primary" style={{ fontSize: 15 }} data-testid="landing-get-started">
                Get started<ArrowRight />
              </button>
            </div>
          </div>

          {/* beat 1 — never start alone */}
          <div className="m-land-beat" style={{ opacity: beat1, pointerEvents: beat1 > 0.5 ? 'auto' : 'none' }}>
            <img className="m-land-photo" alt=""
              src="https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=1600&q=60&auto=format" />
            <div className="m-land-scrim-light" />
            <div className="m-land-beat" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 8vw', maxWidth: 900 }}>
              <h2 className="m-land-title" style={{ fontSize: 'clamp(34px,6vw,68px)', margin: '0 0 22px' }}>Never Start Alone</h2>
              <p style={{ fontSize: 19, lineHeight: 1.5, margin: '0 0 6px', maxWidth: '44ch' }}>You&apos;re a founder, or you&apos;re about to be.</p>
              <p style={{ fontSize: 19, lineHeight: 1.5, margin: 0, maxWidth: '44ch' }}>Builder is employee one. Never sleeps, never stalls.</p>
            </div>
          </div>

          {/* beat 2 — Builder is your team */}
          <div className="m-land-beat" style={{ opacity: beat2, pointerEvents: beat2 > 0.5 ? 'auto' : 'none' }}>
            <div className="m-land-beat" style={{ background: 'var(--color-bg)' }} />
            <div className="m-land-beat m-land-beat2-grid">
              <div>
                <h2 className="m-land-title" style={{ fontSize: 'clamp(30px,4.5vw,52px)', margin: '0 0 26px' }}>Builder is your team.</h2>
                <div style={{ display: 'grid', gap: 14 }}>
                  <div className="m-land-rule">Builder drafts your plan.</div>
                  <div className="m-land-rule">Builder builds your MVP.</div>
                  <div className="m-land-rule">Builder runs your pipeline.</div>
                  <div className="m-land-rule">Builder closes your deals.</div>
                  <div className="m-land-rule is-last">Builder tracks your cap table.</div>
                  <div className="m-land-title" style={{ fontSize: 18 }}>One partner. Every act.</div>
                </div>
              </div>
              <img className="m-land-photo m-land-beat2-photo" alt=""
                src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200&q=60&auto=format" />
            </div>
          </div>

          {/* beat 3 — build a company tonight */}
          <div className="m-land-beat" style={{ opacity: beat3, pointerEvents: beat3 > 0.5 ? 'auto' : 'none' }}>
            <div className="m-land-beat-accent" />
            <div className="m-land-beat-center" style={{ color: '#fff9f7', gap: 26 }}>
              <h2 className="m-land-title" style={{ fontSize: 'clamp(38px,7vw,84px)', margin: 0 }}>Build a company tonight.</h2>
              <button onClick={startFlow} className="m-land-btn-ink" data-testid="landing-get-started-2">
                Get started<ArrowRight />
              </button>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', opacity: .85 }}>
                No credit card required · Free to start
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* footer */}
      <div className="m-land-foot">
        <a href="/about">About</a>
        <a href="https://ainative.studio/terms">Terms</a>
        <a href="https://ainative.studio/acceptable-use">Acceptable use</a>
        <a href="https://ainative.studio/privacy">Privacy</a>
        <span>Support: <a href="mailto:support@ainative.studio">support@ainative.studio</a></span>
      </div>
    </div>
  )
}
