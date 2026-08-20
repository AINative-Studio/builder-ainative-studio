'use client'

/**
 * Workspace shell (#220) — the shared chrome both tracks render inside.
 * Top bar · journey act-bar · path breadcrumb · Cody feed (34%) · center panel
 * · artifact rail. Re-themed per track via the .modernist[data-track] root.
 */

import { useBuild } from '@/contexts/build-context'
import { ACT_LABELS } from '@/lib/build/acts'
import { BuildOverlays } from '@/components/build/BuildOverlays'
import { TerminalRibbon } from '@/components/build/TerminalRibbon'
import { DecisionModal } from '@/components/build/DecisionModal'
import { ArtifactRail } from '@/components/build/ArtifactRail'
import type { ReactNode } from 'react'

function ActBar() {
  const { state, dispatch, woven, totalPrimitives } = useBuild()
  // Map current screen/view to one of the 5 acts for the tracker.
  const actIndex = currentActIndex(state)
  const doneCount = Object.keys(state.done).length
  const initials = (state.companyName || 'You').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className="m-actbar" role="navigation" aria-label="Build progress">
      <ol className="m-acts">
        {ACT_LABELS.map((label, i) => {
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
        <button className="m-account-chip m-mono" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'account' })} title="Account">
          <span className="m-account-initials">{initials}</span>
          <span className="m-token-meter" aria-hidden><span style={{ width: '38%' }} /></span>
        </button>
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
function currentActIndex(state: ReturnType<typeof useBuild>['state']): number {
  // Idea(0) Build MVP(1) Launch(2) Company(3) Live(4)
  if (state.screen === 'fork' || state.screen === 'intake') return 0
  if (state.screen === 'pricing') return 2
  if (state.screen === 'live') return 4
  if (state.track === 'company') return state.builtCompany ? 4 : 3
  return state.builtMVP ? 2 : 1
}
