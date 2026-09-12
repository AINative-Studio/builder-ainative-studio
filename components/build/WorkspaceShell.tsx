'use client'

/**
 * Workspace shell (#220) — the shared chrome both tracks render inside.
 * Top bar · journey act-bar · path breadcrumb · Cody feed (34%) · center panel
 * · artifact rail. Re-themed per track via the .modernist[data-track] root.
 */

import { useState } from 'react'
import { useBuild } from '@/contexts/build-context'
import { useSession } from 'next-auth/react'
import { APP_ACT_LABELS, COMPANY_ACT_LABELS } from '@/lib/build/acts'
import type { Screen } from '@/lib/build/state'
import { BuildOverlays } from '@/components/build/BuildOverlays'
import { TerminalRibbon } from '@/components/build/TerminalRibbon'
import { PricingNudge } from '@/components/build/PricingNudge'
import { DecisionModal } from '@/components/build/DecisionModal'
import { ArtifactRail } from '@/components/build/ArtifactRail'
import { AccountMenu } from '@/components/build/AccountMenu'
import type { ReactNode } from 'react'

function ActBar() {
  const { state, dispatch, woven, totalPrimitives } = useBuild()
  const { data: session } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)

  // Map current screen/view to one of this track's acts for the tracker.
  const actLabels = state.track === 'company' ? COMPANY_ACT_LABELS : APP_ACT_LABELS
  const actIndex = currentActIndex(state)
  const doneCount = Object.keys(state.done).length

  const handleScreen = (screen: string) => {
    dispatch({ type: 'GOTO_SCREEN', screen: screen as Screen })
  }

  return (
    <div className="m-actbar" role="navigation" aria-label="Build progress">
      <ol className="m-acts">
        {actLabels.map((label, i) => {
          const cls = i < actIndex ? 'is-done' : i === actIndex ? 'is-current' : 'is-upcoming'
          return (
            <li key={label} className={`m-act ${cls}`}>
              <span className="m-act-badge" aria-hidden>{i < actIndex ? '✓' : i + 1}</span>
              <span className="m-act-label">{label}</span>
            </li>
          )
        })}
      </ol>
      <div className="m-actbar-right">
        <span className="m-woven m-mono" title="AINative primitives woven into this build">
          {woven}/{totalPrimitives} woven
        </span>
        <button className="m-actbar-btn m-mono" onClick={() => dispatch({ type: 'TOGGLE_INDEX' })} title="Jump to any screen">
          Index
        </button>
        <button className={`m-actbar-btn m-mono ${state.railOpen ? 'is-active' : ''}`} onClick={() => dispatch({ type: 'TOGGLE_RAIL' })} title="Artifacts">
          Artifacts · {doneCount}
        </button>
        {/* Unified account nav dropdown (#56) — replaces bare chip. */}
        <AccountMenu
          session={session}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          onScreen={handleScreen}
        />
      </div>
    </div>
  )
}

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

function PathBreadcrumb() {
  const { state, views, goView } = useBuild()
  return (
    <div className="m-breadcrumb" role="navigation" aria-label="Artifacts">
      {views.map((v) => {
        const isCurrent = v === state.view
        const isDone = Boolean(state.done[v])
        const clickable = !state.auto && (isDone || isCurrent)
        const cls = isCurrent ? 'is-current' : isDone ? 'is-done' : 'is-upcoming'
        return (
          <button
            key={v}
            className={`m-crumb m-mono ${cls}`}
            disabled={!clickable}
            onClick={() => clickable && goView(v as never)}
          >
            {v}
          </button>
        )
      })}
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
      <ActBar />
      <IndexPanel />
      <PathBreadcrumb />
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
