'use client'

/**
 * BuildStart — funnel step 2 (Claude Design handoff). "Let's build something."
 *
 *   Surprise me   → an LLM invents a starter idea (POST /api/build/surprise-idea,
 *                   grounded in the real primitive catalog, biased toward
 *                   whatever primitives haven't shown up recently — falls back
 *                   to the static pool in lib/build/surprise-ideas.ts on any
 *                   failure/timeout), then the founder refines it in Intake.
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

/** "Surprise me" is a single click a founder expects to feel near-instant —
 *  a hung LLM call must never leave the button spinning indefinitely, so the
 *  client enforces its own timeout independent of the route's own. */
const SURPRISE_IDEA_CLIENT_TIMEOUT_MS = 10000

export function BuildStart() {
  const { dispatch, pickTrack } = useBuild()
  const [role, setRole] = useState<CompanyRole>('')
  const [isSurprising, setIsSurprising] = useState(false)
  // Tracks the last-shown idea (across clicks in this mount, not persisted)
  // purely so the static-pool fallback can avoid an immediate back-to-back repeat.
  const lastIdeaRef = useRef<string | null>(null)

  const goIntake = () => {
    window.scrollTo(0, 0)
    // The funnel creates a company → Company track. PICK_TRACK routes to Intake.
    // #448: an optional role (Marketing/Sales/Operations) narrows what gets
    // built so the outcome is legible, instead of one undifferentiated
    // "company" — '' (no role picked) keeps today's behavior exactly.
    pickTrack('company', role || undefined)
  }

  const pickSurprise = async () => {
    if (isSurprising) return // ignore a double-click while a request is in flight
    setIsSurprising(true)
    // The idea now comes from a real LLM call (POST /api/build/surprise-idea),
    // grounded in the full real primitive catalog and biased toward whatever
    // primitives haven't shown up in recent picks — the static SURPRISE_IDEAS
    // pool (lib/build/surprise-ideas.ts) structurally could never surface most
    // of the catalog (fixed 14-string array, each idea only ever triggers
    // whichever primitives happen to share its hardcoded words). That pool is
    // kept as the fallback below, not the primary path, for exactly the
    // moment this call fails or times out.
    let idea: string
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), SURPRISE_IDEA_CLIENT_TIMEOUT_MS)
      const res = await fetch('/api/build/surprise-idea', { method: 'POST', signal: controller.signal })
      clearTimeout(timer)
      const json = res.ok ? await res.json().catch(() => null) : null
      idea = typeof json?.idea === 'string' && json.idea.trim() ? json.idea : pickSurpriseIdea(lastIdeaRef.current)
    } catch {
      // Network error, timeout, or abort — never leave the founder stuck with
      // no idea because the model call failed; fall back to the static pool.
      idea = pickSurpriseIdea(lastIdeaRef.current)
    }
    lastIdeaRef.current = idea
    setIsSurprising(false)
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
          <button
            onClick={pickSurprise}
            disabled={isSurprising}
            aria-busy={isSurprising}
            className="btn-secondary m-land-btn-block"
            style={{ padding: '18px 20px', fontSize: 15, opacity: isSurprising ? 0.7 : 1, cursor: isSurprising ? 'wait' : 'pointer' }}
            data-testid="build-surprise"
          >
            {isSurprising ? 'Thinking of something…' : 'Surprise me'}
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
