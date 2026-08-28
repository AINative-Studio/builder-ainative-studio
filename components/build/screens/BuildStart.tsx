'use client'

/**
 * BuildStart — funnel step 2 (Claude Design handoff). "Let's build something."
 *
 *   Surprise me   → Builder seeds a starter idea, then the founder refines it in Intake.
 *   Build my idea → straight to Intake with a blank field.
 *
 * Both commit the Company track (the funnel's "create a company" framing) and
 * route into the existing Intake → auth-wall → builder path. Rendered as the
 * `build` screen in the BuildApp state machine.
 */

import { useBuild } from '@/contexts/build-context'

/** A small rotating pool of concrete starter ideas for "Surprise me". Index is
 *  derived from the clock so it varies per visit without needing Math.random in
 *  render. Kept concrete + on-brand (real, buildable AI-native companies). */
const SURPRISE_IDEAS = [
  'An AI answer engine that replies from a company’s own docs and tools, with citations.',
  'A nightly agent that reviews a startup’s pipeline and drafts the next-best outreach for each deal.',
  'A support copilot that resolves tickets from your knowledge base and escalates only what it can’t.',
  'An invoicing service where closed deals auto-bill and reconcile against the cap table.',
  'A research assistant that monitors a market and files a morning brief on what changed and why.',
]

export function BuildStart() {
  const { dispatch, pickTrack } = useBuild()

  const goIntake = () => {
    window.scrollTo(0, 0)
    // The funnel creates a company → Company track. PICK_TRACK routes to Intake.
    pickTrack('company')
  }

  const pickSurprise = () => {
    const idea = SURPRISE_IDEAS[Math.floor(Date.now() / 60000) % SURPRISE_IDEAS.length]
    dispatch({ type: 'SET_IDEA', idea })
    goIntake()
  }

  const backToStart = () => { window.scrollTo(0, 0); dispatch({ type: 'GOTO_SCREEN', screen: 'start' }) }

  return (
    <div className="modernist" style={{ minHeight: 'calc(100vh - 41px)', display: 'flex', flexDirection: 'column' }}>
      <div className="m-land-nav" style={{ position: 'static' }}>
        <button onClick={() => { window.scrollTo(0, 0); dispatch({ type: 'GOTO_SCREEN', screen: 'landing' }) }} className="m-land-title" style={{ fontSize: 22, background: 'none', border: 0, cursor: 'pointer', padding: 0 }} aria-label="Back to the landing page" data-testid="funnel-brand-home">BUILDER</button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', gap: 20 }}>
        <div style={{ width: '100%', maxWidth: 420 }}>
          <button onClick={backToStart} className="m-land-signin" style={{ letterSpacing: '.06em' }} data-testid="build-back">
            &larr; Back
          </button>
        </div>

        <h1 className="m-land-title" style={{ fontSize: 'clamp(30px,5vw,52px)', margin: '0 0 8px' }}>Let&apos;s build something.</h1>

        <div style={{ display: 'grid', gap: 6, width: '100%', maxWidth: 420 }}>
          <button onClick={pickSurprise} className="btn-secondary m-land-btn-block" style={{ padding: '18px 20px', fontSize: 15 }} data-testid="build-surprise">
            Surprise me
          </button>
          <div className="m-land-opt-sub" style={{ textAlign: 'center', marginBottom: 8 }}>Builder will come up with an idea</div>

          <div className="m-land-or">OR</div>

          <button onClick={goIntake} className="btn-primary m-land-btn-block" style={{ padding: '18px 20px', fontSize: 15 }} data-testid="build-own-idea">
            Build my idea
          </button>
        </div>
      </div>
    </div>
  )
}
