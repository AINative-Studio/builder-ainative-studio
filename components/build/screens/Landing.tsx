'use client'

/**
 * Landing — the public marketing front door (Updated_builder_landing design,
 * 2026-09-14). A four-beat pinned-scroll ("scrollytelling") hero in the
 * Modernist system, shown to cold/logged-out visitors before the builder path.
 *
 * Beats (crossfaded by scroll progress over a 4×-viewport pinned stage):
 *   0. The Company That Builds Itself   (full-bleed grayscale hero + Get started)
 *   1. You Are Not Alone                (Cody's ship beams him down)
 *   2. A cofounder from another world.  (rule list of what Cody does)
 *   3. Build a company tonight.         (full-bleed accent close-out + Get started)
 *
 * Cody's beam-down sequence (ship + tractor beam + hopping 8-bit sprite)
 * persists across beats 1-2, driven by the same scroll progress. Real ambient
 * audio (not synthesized) plays underneath: a looping space drone, a rising
 * sweep as the beam engages, and an 8-bit landing chime once Cody touches
 * down — all opt-in via the "Sound" toggle, matching browser autoplay rules
 * (armed on the visitor's first scroll/gesture, never before).
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

const AUDIO = {
  drone: '/audio/cody-space-drone-loop.mp3',
  beam: '/audio/cody-beam-sweep.mp3',
  land8bit: '/audio/cody-landing-8bit.mp3',
  landSoft: '/audio/cody-landing-soft.mp3',
} as const

const ArrowRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
  </svg>
)

/** Clamp a scroll-progress sub-segment to 0..1, smoothstepped. */
function seg(p: number, start: number, end: number): number {
  if (p < start) return 0
  if (p > end) return 1
  const t = (p - start) / (end - start)
  return t * t * (3 - 2 * t)
}

export function Landing() {
  const { dispatch } = useBuild()
  const { status } = useSession()
  const [progress, setProgress] = useState(0)
  const [tickerIdx, setTickerIdx] = useState(0)
  const [soundOn, setSoundOn] = useState(false)
  const [audioRunning, setAudioRunning] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  const droneRef = useRef<HTMLAudioElement | null>(null)
  const beamRef = useRef<HTMLAudioElement | null>(null)
  const landRef = useRef<HTMLAudioElement | null>(null)
  const beamPlayedRef = useRef(false)
  const landPlayedRef = useRef(false)
  const armedRef = useRef(false)
  const soundOnRef = useRef(false)
  const fadeRafRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  const startFlow = () => { window.scrollTo(0, 0); dispatch({ type: 'GOTO_SCREEN', screen: 'start' }) }
  // Signed-out → auth; signed-in → straight into their builds (My Builds). The
  // landing shows for everyone (founder direction) — this is the fast lane out.
  const goSignIn = () => { window.scrollTo(0, 0); dispatch({ type: 'GOTO_SCREEN', screen: 'login' }) }
  const openBuilder = () => { window.scrollTo(0, 0); dispatch({ type: 'GOTO_SCREEN', screen: 'companies' }) }

  // Lazily create the <audio> elements once, on the client only.
  useEffect(() => {
    mountedRef.current = true
    const drone = new Audio(AUDIO.drone)
    drone.loop = true
    drone.volume = 0
    droneRef.current = drone
    beamRef.current = new Audio(AUDIO.beam)
    landRef.current = new Audio(AUDIO.land8bit)
    return () => {
      mountedRef.current = false
      if (fadeRafRef.current != null) cancelAnimationFrame(fadeRafRef.current)
      drone.pause()
      beamRef.current?.pause()
      landRef.current?.pause()
    }
  }, [])

  // Both fades share one in-flight rAF loop tracked in fadeRafRef — starting
  // one cancels any fade already running, so a rapid toggle-toggle never
  // races two loops fighting over the same volume, and unmount can always
  // cancel whichever one is live (jsdom/tests: a stray rAF touching a
  // torn-down <audio> element after unmount throws, so this must never
  // outlive the component).
  const startAudio = () => {
    const drone = droneRef.current
    if (!drone) return
    if (fadeRafRef.current != null) cancelAnimationFrame(fadeRafRef.current)
    setAudioRunning(true)
    drone.play().catch(() => { if (mountedRef.current) setAudioRunning(false) })
    // Fade the drone in rather than snapping to full volume.
    const target = 0.6
    const start = performance.now()
    const fade = (t: number) => {
      if (!mountedRef.current) return
      // rAF timestamps mark frame START, which can arrive fractionally
      // BEFORE the performance.now() captured above mid-frame — an
      // unclamped lower bound let k go slightly negative on the very first
      // tick, and HTMLMediaElement.volume throws outside [0,1], which
      // silently killed the whole fade (confirmed live: a real
      // uncaught pageerror on volume=-0.000096 broke ambient audio
      // entirely, 2026-09-14).
      const k = Math.max(0, Math.min(1, (t - start) / 2500))
      drone.volume = target * k
      fadeRafRef.current = k < 1 ? requestAnimationFrame(fade) : null
    }
    fadeRafRef.current = requestAnimationFrame(fade)
  }

  const stopAudio = () => {
    const drone = droneRef.current
    if (!drone) return
    if (fadeRafRef.current != null) cancelAnimationFrame(fadeRafRef.current)
    const startVol = drone.volume
    const start = performance.now()
    const fade = (t: number) => {
      if (!mountedRef.current) return
      const k = Math.max(0, Math.min(1, (t - start) / 600))
      drone.volume = startVol * (1 - k)
      if (k < 1) { fadeRafRef.current = requestAnimationFrame(fade) }
      else { fadeRafRef.current = null; drone.pause(); setAudioRunning(false) }
    }
    fadeRafRef.current = requestAnimationFrame(fade)
  }

  const playCue = (ref: React.RefObject<HTMLAudioElement | null>) => {
    const el = ref.current
    if (!el) return
    el.currentTime = 0
    el.play().catch(() => {})
  }

  // Sound starts opt-in only: arm on the visitor's first scroll/gesture so a
  // real user activation exists (autoplay policies block audio otherwise),
  // then start ambient audio automatically once that happens.
  useEffect(() => {
    const evs: (keyof WindowEventMap)[] = ['wheel', 'touchstart', 'scroll', 'pointerdown', 'keydown']
    const tryStart = () => {
      if (armedRef.current) return
      armedRef.current = true
      setSoundOn(true)
      soundOnRef.current = true
      startAudio()
      evs.forEach((e) => window.removeEventListener(e, tryStart))
    }
    evs.forEach((e) => window.addEventListener(e, tryStart, { passive: true }))
    return () => evs.forEach((e) => window.removeEventListener(e, tryStart))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleSound = () => {
    const next = !soundOnRef.current
    soundOnRef.current = next
    setSoundOn(next)
    armedRef.current = true
    if (next) startAudio()
    else stopAudio()
  }

  // Scroll → progress. The stage is 4× viewport tall; progress maps the scroll
  // position within it to 0..1 (the prototype's 3.15 divisor keeps the last
  // beat fully settled before the stage ends).
  useEffect(() => {
    const onScroll = () => {
      const p = Math.max(0, Math.min(1, window.scrollY / (window.innerHeight * 3.15)))
      setProgress(p)

      const beamOn = p > 0.055
      const landed = p > 0.2
      if (soundOnRef.current) {
        if (beamOn && !beamPlayedRef.current) { beamPlayedRef.current = true; playCue(beamRef) }
        if (landed && !landPlayedRef.current) { landPlayedRef.current = true; playCue(landRef) }
      }
      if (p < 0.03) { beamPlayedRef.current = false; landPlayedRef.current = false }
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
  const codyLayerOpacity = Math.max(0, seg(p, 0.03, 0.14) - seg(p, 0.69, 0.80))
  const codyDrop = `${(1 - seg(p, 0.03, 0.2)) * -70}vh`
  const beamOpacity = Math.max(0, Math.min(1, seg(p, 0.05, 0.14) - seg(p, 0.19, 0.25)))
  const shipDrop = `${(-1 + Math.max(0, Math.min(1, seg(p, 0.04, 0.12) - seg(p, 0.19, 0.26)))) * 100 - 10}%`

  const soundLabel = soundOn ? (audioRunning ? 'Sound on' : 'Sound · tap to start') : 'Sound off'

  return (
    <div className="modernist" style={{ minHeight: '100vh' }}>
      {/* machine-speech ticker */}
      <div className="m-land-ticker">&gt; {TICKER_LINES[tickerIdx]}<span className="m-caret">_</span></div>

      {/* top nav */}
      <div className="m-land-nav">
        <div className="m-land-brand">
          <img className="m-land-brand-icon" alt="" aria-hidden="true"
            src="https://ainative.studio/mediakit/logos/ainative-studio-logo-mark-primary.svg" />
          <div className="m-land-title" style={{ fontSize: 22 }}>BUILDER</div>
          <span className="m-land-brand-by m-mono">by AINative</span>
        </div>
        <div className="m-land-nav-actions">
          <button onClick={toggleSound} className="m-land-sound" data-testid="landing-sound-toggle" aria-pressed={soundOn}>
            <span className={`m-land-sound-dot${soundOn && audioRunning ? ' is-on' : ''}`} />
            {soundLabel}
          </button>
          {status === 'authenticated' ? (
            <button onClick={openBuilder} className="m-land-signin" data-testid="landing-open-builder">Open Builder →</button>
          ) : (
            <button onClick={goSignIn} className="m-land-signin" data-testid="landing-signin">Sign in</button>
          )}
        </div>
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
              src="https://commons.wikimedia.org/wiki/Special:FilePath/Pillars_of_creation_2014_HST_WFC3-UVIS_full-res_denoised.jpg?width=1600" />
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

          {/* beat 1 — You Are Not Alone (Cody's ship arrives) */}
          <div className="m-land-beat" style={{ opacity: beat1, pointerEvents: beat1 > 0.5 ? 'auto' : 'none' }}>
            <img className="m-land-photo" alt=""
              src="https://commons.wikimedia.org/wiki/Special:FilePath/Pillars_of_creation_2014_HST_WFC3-UVIS_full-res_denoised.jpg?width=1600" />
            <div className="m-land-scrim-dark" />
            <div className="m-land-beat" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,.9fr)', alignItems: 'center', gap: '4vw', padding: '0 8vw', color: '#f3f2f2' }}>
              <div>
                <div className="m-mono" style={{ fontSize: 22, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--color-accent)', marginBottom: 18 }}>Incoming · Cody</div>
                <h2 className="m-land-title" style={{ fontSize: 'clamp(34px,6vw,68px)', margin: '0 0 22px' }}>You Are Not Alone</h2>
                <p style={{ fontSize: 19, lineHeight: 1.5, margin: '0 0 6px', maxWidth: '40ch' }}>Meet Cody — the open-source CTO cofounder you always wished you had.</p>
                <p style={{ fontSize: 19, lineHeight: 1.5, margin: 0, maxWidth: '40ch' }}>We beam him down from the cloud. He builds whatever you can imagine.</p>
              </div>
              <div />
            </div>
          </div>

          {/* Cody-beam layer — persists across beats 1-2 */}
          <div className="m-land-cody-layer" style={{ opacity: codyLayerOpacity }}>
            <div />
            <div className="m-land-cody-stage">
              <div className="m-land-ship" style={{ transform: `translate(-50%, ${shipDrop})`, opacity: beamOpacity }}>
                <div className="m-land-ship-hull">
                  <div className="m-land-ship-glow" />
                  <div className="m-land-ship-lights">
                    <span className="m-land-ship-light" /><span className="m-land-ship-light" />
                    <span className="m-land-ship-light" /><span className="m-land-ship-light" />
                    <span className="m-land-ship-light" />
                  </div>
                </div>
              </div>
              <div className="m-land-beam" style={{ opacity: beamOpacity }} />
              <div className="m-land-cody-wrap" style={{ transform: `translateY(${codyDrop})` }}>
                <div className="m-land-cody-glow" />
                <div className="m-land-cody-sprite">
                  <img src="https://ainative.studio/mediakit/mascots/ainative-8bit-cody-transparent-512.png" alt="8-Bit Cody" />
                </div>
                <div className="m-land-cody-pool" />
              </div>
            </div>
          </div>

          {/* beat 2 — A cofounder from another world */}
          <div className="m-land-beat" style={{ opacity: beat2, pointerEvents: beat2 > 0.5 ? 'auto' : 'none' }}>
            <img className="m-land-photo" alt=""
              src="https://commons.wikimedia.org/wiki/Special:FilePath/Pillars_of_creation_2014_HST_WFC3-UVIS_full-res_denoised.jpg?width=1600" />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg,rgba(0,0,0,.6) 0%,rgba(0,0,0,.45) 55%,rgba(0,0,0,.25) 100%)' }} />
            <div className="m-land-beat m-land-beat2-grid" style={{ color: '#f3f2f2' }}>
              <div>
                <div className="m-mono" style={{ fontSize: 22, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--color-accent)', marginBottom: 18 }}>Not from here. Built for you.</div>
                <h2 className="m-land-title" style={{ fontSize: 'clamp(30px,4.5vw,52px)', margin: '0 0 26px' }}>A cofounder from another world.</h2>
                <div style={{ display: 'grid', gap: 14, fontSize: 18, lineHeight: 1.4 }}>
                  <div style={{ borderTop: '2px solid rgba(243,242,242,.35)', paddingTop: 14 }}>Cody drafts your plan.</div>
                  <div style={{ borderTop: '2px solid rgba(243,242,242,.35)', paddingTop: 14 }}>Cody builds your MVP.</div>
                  <div style={{ borderTop: '2px solid rgba(243,242,242,.35)', paddingTop: 14 }}>Cody runs your pipeline.</div>
                  <div style={{ borderTop: '2px solid rgba(243,242,242,.35)', paddingTop: 14 }}>Cody deploys to the cloud he came from.</div>
                  <div style={{ borderTop: '2px solid rgba(243,242,242,.35)', borderBottom: '2px solid rgba(243,242,242,.35)', paddingTop: 14, paddingBottom: 14 }}>Cody never sleeps. Never leaves.</div>
                  <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, textTransform: 'uppercase' }}>Open source. Alien-grade. Yours.</div>
                </div>
              </div>
              <div className="m-land-beat2-photo" />
            </div>
          </div>

          {/* beat 3 — build a company tonight */}
          <div className="m-land-beat" style={{ opacity: beat3, pointerEvents: beat3 > 0.5 ? 'auto' : 'none' }}>
            <div className="m-land-beat-accent" />
            <div className="m-land-beat-center" style={{ color: '#fff9f7', gap: 26 }}>
              <h2 className="m-land-title" style={{ fontSize: 'clamp(38px,7vw,84px)', margin: 0 }}>Build a company tonight.</h2>
              <div className="m-mono" style={{ fontSize: 'clamp(13px,1.4vw,18px)', letterSpacing: '.22em', textTransform: 'uppercase', opacity: .9 }}>You are not alone.</div>
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
        <a href="/showcase">Showcase</a>
        <a href="/capabilities">What can I build?</a>
        <a href="/about">About</a>
        <a href="https://ainative.studio/terms">Terms</a>
        <a href="https://ainative.studio/acceptable-use">Acceptable use</a>
        <a href="https://ainative.studio/privacy">Privacy</a>
        <span>Support: <a href="mailto:support@ainative.studio">support@ainative.studio</a></span>
      </div>
    </div>
  )
}
