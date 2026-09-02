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

import { useRef, useState } from 'react'
import { useBuild } from '@/contexts/build-context'
import { COMPANY_ROLES } from '@/lib/build/primitive-catalog'
import type { CompanyRole } from '@/lib/build/state'
import { pickSurpriseIdea } from '@/lib/build/surprise-ideas'

export function BuildStart() {
  const { dispatch, pickTrack } = useBuild()
  const [role, setRole] = useState<CompanyRole>('')
  // Tracks the last-shown idea (across clicks in this mount, not persisted)
  // purely so pickSurpriseIdea can avoid an immediate back-to-back repeat.
  const lastIdeaRef = useRef<string | null>(null)

  const goIntake = () => {
    window.scrollTo(0, 0)
    // The funnel creates a company → Company track. PICK_TRACK routes to Intake.
    // #448: an optional role (Marketing/Sales/Operations) narrows what gets
    // built so the outcome is legible, instead of one undifferentiated
    // "company" — '' (no role picked) keeps today's behavior exactly.
    pickTrack('company', role || undefined)
  }

  const pickSurprise = () => {
    // A real click handler, so Math.random() (inside pickSurpriseIdea) is
    // safe here — unlike in render, where it would break SSR hydration.
    // Previously this was Math.floor(Date.now()/60000) % 5: a 5-idea pool,
    // deterministically bucketed by the clock, so repeated clicks within
    // the same minute always returned the identical idea.
    const idea = pickSurpriseIdea(lastIdeaRef.current)
    lastIdeaRef.current = idea
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

        {/* #448: optional role focus — makes "build a company" a legible,
            specific outcome (a Marketing/Sales/Operations build) instead of
            one undifferentiated build. Skippable: leaving nothing selected
            keeps today's behavior exactly. */}
        <div style={{ width: '100%', maxWidth: 420, marginTop: 4 }}>
          <div className="m-land-opt-sub" style={{ textAlign: 'center', marginBottom: 8 }}>
            Optional — focus the build on one function
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }} role="group" aria-label="Focus this company build on a specific function">
            {COMPANY_ROLES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRole(role === r.id ? '' : r.id)}
                aria-pressed={role === r.id}
                title={r.description}
                data-testid={`build-role-${r.id}`}
                className="btn-secondary"
                style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  borderColor: role === r.id ? 'currentColor' : undefined,
                  fontWeight: role === r.id ? 600 : 400,
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
