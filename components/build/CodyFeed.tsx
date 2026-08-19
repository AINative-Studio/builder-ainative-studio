'use client'

/** Cody feed (#220/#221) — left panel, Cody's running commentary + nudge cards. */

import { useBuild } from '@/contexts/build-context'
import { PRIMITIVE_MAP } from '@/lib/build/primitives'
import { CodyNudge } from '@/components/build/CodyNudge'

export function CodyFeed() {
  const { state } = useBuild()
  const nudge = PRIMITIVE_MAP[state.view]?.nudge
  const nudgeState = state.nudgeState[state.view]
  const showNudge = nudge && nudgeState === undefined

  return (
    <div className="m-cody-feed">
      <div className="m-cody-header m-mono"><span className="m-glyph">◇</span> Cody</div>
      <div className="m-feed-lines">
        <p className="m-feed-line m-linein">
          Working on <span className="m-mono">{state.view}</span>
          {state.building ? '…' : ' — done.'}
        </p>
      </div>
      {showNudge && <CodyNudge view={state.view} nudge={nudge} />}
      {nudgeState === 'accepted' && nudge && (
        <p className="m-feed-line m-nudge-done">✓ Woven in. {nudge.prim} is part of this company now.</p>
      )}
    </div>
  )
}
