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
import type { ReactNode } from 'react'

function ActBar() {
  const { state, woven, totalPrimitives } = useBuild()
  // Map current screen/view to one of the 5 acts for the tracker.
  const actIndex = currentActIndex(state)
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
      <PathBreadcrumb />
      <TerminalRibbon />
      <div className={`m-ws-body ${state.tablet ? 'is-tablet' : ''}`}>
        {feed && !state.tablet && <aside className="m-feed">{feed}</aside>}
        <main className="m-center">
          {state.overlay.kind !== 'none' ? <BuildOverlays /> : children}
        </main>
        {rail && <aside className="m-rail">{rail}</aside>}
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
