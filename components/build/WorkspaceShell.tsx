'use client'

/**
 * Workspace shell (#220) — the shared chrome both tracks render inside.
 * Top bar · journey bar (#BLD-06.1, merges the old act-bar + path breadcrumb)
 * · Cody feed (34%) · center panel · artifact rail. Re-themed per track via
 * the .modernist[data-track] root.
 */

import { useBuild } from '@/contexts/build-context'
import { BuildOverlays } from '@/components/build/BuildOverlays'
import { TerminalRibbon } from '@/components/build/TerminalRibbon'
import { PricingNudge } from '@/components/build/PricingNudge'
import { DecisionModal } from '@/components/build/DecisionModal'
import { ArtifactRail } from '@/components/build/ArtifactRail'
import { JourneyBar } from '@/components/build/JourneyBar'
import type { ReactNode } from 'react'

/** Index (jump-to-any-screen) panel — quick nav to any generated artifact. */
function IndexPanel() {
  const { state, views, dispatch, goView } = useBuild()
  if (!state.indexOpen) return null
  return (
    <div className="m-index-panel" role="dialog" aria-label="Jump to a screen">
      <div className="m-index-head m-mono">
        <span>Jump to</span>
        <button className="m-rail-close" onClick={() => dispatch({ type: 'TOGGLE_INDEX' })} aria-label="Close">✕</button>
      </div>
      <div className="m-index-grid">
        {views.map((v) => {
          const done = Boolean(state.done[v])
          return (
            <button
              key={v}
              className={`m-index-item m-mono ${done ? 'is-done' : 'is-upcoming'} ${state.view === v ? 'is-current' : ''}`}
              disabled={!done}
              onClick={() => { goView(v as never); dispatch({ type: 'TOGGLE_INDEX' }) }}
            >
              {v}
            </button>
          )
        })}
      </div>
      {/* #253: quick nav to the founder's companies index + account. */}
      <div className="m-index-foot m-mono">
        <button className="m-index-item m-mono" onClick={() => { dispatch({ type: 'GOTO_SCREEN', screen: 'companies' }); dispatch({ type: 'TOGGLE_INDEX' }) }}>
          My companies
        </button>
        <button className="m-index-item m-mono" onClick={() => { dispatch({ type: 'GOTO_SCREEN', screen: 'account' }); dispatch({ type: 'TOGGLE_INDEX' }) }}>
          Account
        </button>
      </div>
    </div>
  )
}


export function WorkspaceShell({
  feed,
  rail,
  children,
}: {
  feed?: ReactNode
  rail?: ReactNode
  children: ReactNode
}) {
  const { state } = useBuild()
  return (
    <div className="modernist m-ws" data-track={state.track}>
      <header className="m-topbar">
        <span className="m-brand m-mono">Builder</span>
        <span className={`m-trackpill m-mono is-${state.track}`}>
          {state.track === 'app' ? 'App Track' : 'Company Track'}
        </span>
        <span className="m-topbar-artifact m-artifact">{state.companyName || 'Untitled'}</span>
      </header>
      <JourneyBar />
      <IndexPanel />
      <TerminalRibbon />
      <PricingNudge />
      <div className={`m-ws-body ${state.tablet ? 'is-tablet' : ''}`}>
        {feed && !state.tablet && <aside className="m-feed">{feed}</aside>}
        <main className="m-center">
          {state.overlay.kind !== 'none' ? <BuildOverlays /> : children}
        </main>
        {rail && <aside className="m-rail">{rail}</aside>}
        <ArtifactRail />
      </div>
      <DecisionModal />
    </div>
  )
}

// ---- helpers ----
export function currentActIndex(state: ReturnType<typeof useBuild>['state']): number {
  if (state.screen === 'fork' || state.screen === 'intake') return 0
  if (state.screen === 'live') return 4
  if (state.track === 'company') {
    // Company: Idea(0) Build MVP(1) Launch(2) Company(3) Live(4). Company's
    // act bar has no dedicated "Design" label (COMPANY_ACT_LABELS, unlike the
    // App track) — the Design interrupt-view (now also visited on this track,
    // see PICK_TRACK's comment) reads as still "Idea" rather than jumping
    // ahead to Build MVP before a choice is made.
    if (state.screen === 'pricing') return 2
    if (!state.designStepDone) return 0
    return state.builtCompany ? 4 : 3
  }
  // App: Idea(0) Design(1) Build MVP(2) Launch(3) Live(4). Real bug
  // (customer-reported, 2026-09-09): Design (#591) used to be invisible here
  // entirely — the bar jumped straight from Idea to Build MVP as soon as
  // generation started, even while the founder was still on the Design
  // interrupt-view. designStepDone (not yet true) means still on Design.
  if (state.screen === 'pricing') return 3
  if (!state.designStepDone) return 1
  return state.builtMVP ? 3 : 2
}
