'use client'

/**
 * Journey bar (#BLD-06.1) — merges the old separate ActBar (phase row) and
 * PathBreadcrumb (artifact chip row) into one component, per Epic 2's
 * acceptance scenario: "one journey bar shows phases and the current
 * phase's artifacts." The chip row renders the FULL views sequence, not
 * filtered to the current phase — see the design spec's note on why a
 * view→phase mapping is out of scope for this story (no such mapping
 * exists anywhere in this codebase today, and currentActIndex answers a
 * different question — "which phase is the whole workspace in" — not
 * "which phase does this specific artifact belong to").
 */

import { useState } from 'react'
import { useBuild } from '@/contexts/build-context'
import { useSession } from 'next-auth/react'
import { APP_ACT_LABELS, COMPANY_ACT_LABELS } from '@/lib/build/acts'
import { ARTIFACT_TITLES } from '@/lib/build/titles'
import type { Screen } from '@/lib/build/state'
import { AccountMenu } from '@/components/build/AccountMenu'
import { currentActIndex } from '@/components/build/WorkspaceShell'

export function JourneyBar() {
  const { state, views, dispatch, goView, woven, totalPrimitives } = useBuild()
  const { data: session } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)

  const actLabels = state.track === 'company' ? COMPANY_ACT_LABELS : APP_ACT_LABELS
  const actIndex = currentActIndex(state)

  const handleScreen = (screen: string) => {
    dispatch({ type: 'GOTO_SCREEN', screen: screen as Screen })
  }

  return (
    <div className="m-journey-bar" role="navigation" aria-label="Build progress">
      <div className="m-journey-phases">
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
          <AccountMenu
            session={session}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            onScreen={handleScreen}
          />
        </div>
      </div>
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
              {ARTIFACT_TITLES[v] ?? v}
            </button>
          )
        })}
      </div>
    </div>
  )
}
