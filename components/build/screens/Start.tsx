'use client'

/**
 * Start — funnel step 1 (Claude Design handoff). "Let's get started." The visitor
 * picks whether they're creating a new company or growing an existing one.
 *
 * #BLD-10 — both paths now reach the same build/kickoff flow; growthIntent
 * (set here) selects which kickoff question variant KickoffQuestions.tsx
 * shows. The auth-wall decision is untouched — it stays in
 * KickoffQuestions.tsx's proceed(), same as the "create" path already used.
 *
 * Selection is a two-card single-choice; Continue commits it. Matches the
 * prototype's create/grow branch (Landing & Signup.dc.html).
 */

import { useState } from 'react'
import { useBuild } from '@/contexts/build-context'

type Path = 'create' | 'grow'

const ArrowRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
  </svg>
)
const Check = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export function Start() {
  const { dispatch } = useBuild()
  const [path, setPath] = useState<Path>('create')

  const goBuild = () => {
    window.scrollTo(0, 0)
    // #BLD-10 — both paths reach the same idea-entry/kickoff flow now;
    // growthIntent tells KickoffQuestions.tsx which question variant to show.
    dispatch({ type: 'SET_GROWTH_INTENT', value: path === 'grow' })
    dispatch({ type: 'GOTO_SCREEN', screen: 'build' })
  }

  return (
    <div className="modernist" style={{ minHeight: 'calc(100vh - 41px)', display: 'flex', flexDirection: 'column' }}>
      <div className="m-land-nav" style={{ position: 'static' }}>
        <button onClick={() => { window.scrollTo(0, 0); dispatch({ type: 'GOTO_SCREEN', screen: 'landing' }) }} className="m-land-title" style={{ fontSize: 22, background: 'none', border: 0, cursor: 'pointer', padding: 0 }} aria-label="Back to the landing page" data-testid="funnel-brand-home">BUILDER</button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', gap: 36 }}>
        <div style={{ width: '100%', maxWidth: 420 }}>
          <button onClick={() => { window.scrollTo(0, 0); dispatch({ type: 'GOTO_SCREEN', screen: 'landing' }) }} className="m-land-signin" style={{ letterSpacing: '.06em' }} data-testid="start-back">&larr; Back</button>
        </div>
        <h1 className="m-land-title" style={{ fontSize: 'clamp(30px,5vw,52px)', margin: 0 }}>Let&apos;s get started.</h1>

        <div style={{ display: 'grid', gap: 8, width: '100%', maxWidth: 420 }}>
          <button
            type="button"
            onClick={() => setPath('create')}
            className={`m-land-opt${path === 'create' ? ' is-sel' : ''}`}
            data-testid="start-create"
            aria-pressed={path === 'create'}
          >
            <div className="m-land-opt-h">
              Create a new company
              {path === 'create' && <Check />}
            </div>
            <div className="m-land-opt-sub">Start from scratch</div>
          </button>

          <div className="m-land-or">OR</div>

          <button
            type="button"
            onClick={() => setPath('grow')}
            className={`m-land-opt${path === 'grow' ? ' is-sel' : ''}`}
            data-testid="start-grow"
            aria-pressed={path === 'grow'}
          >
            <div className="m-land-opt-h">
              Grow my company
              {path === 'grow' && <Check />}
            </div>
            <div className="m-land-opt-sub">Already have a business</div>
          </button>
        </div>

        <button onClick={goBuild} className="btn-primary m-land-btn-block" style={{ maxWidth: 420 }} data-testid="start-continue">
          Continue<ArrowRight />
        </button>
      </div>
    </div>
  )
}
