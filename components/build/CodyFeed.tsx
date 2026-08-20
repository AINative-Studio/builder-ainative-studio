'use client'

/** Cody feed (#220/#221) — left panel, Cody's running commentary + nudge cards. */

import { useBuild } from '@/contexts/build-context'
import { PRIMITIVE_MAP } from '@/lib/build/primitives'
import { CodyNudge } from '@/components/build/CodyNudge'

export function CodyFeed() {
  const { state, views } = useBuild()
  const nudge = PRIMITIVE_MAP[state.view]?.nudge
  const nudgeState = state.nudgeState[state.view]
  const showNudge = nudge && nudgeState === undefined

  // Real progress: how many artifacts Cody has generated so far, and whether the
  // current view is still drafting (no generated content + no error yet).
  const doneCount = views.filter((v) => state.done[v]).length
  const currentPending = !state.done[state.view] && !state.genError[state.view]
  const currentFailed = !!state.genError[state.view]

  return (
    <div className="m-cody-feed">
      <div className="m-cody-header m-mono"><span className="m-glyph">◇</span> Cody</div>
      <div className="m-feed-lines">
        {/* running commentary — one line per artifact already generated */}
        {views.filter((v) => state.done[v]).map((v) => (
          <p key={v} className="m-feed-line m-linein">✓ <span className="m-mono">{v}</span> — drafted.</p>
        ))}
        <p className="m-feed-line m-linein">
          {currentFailed ? (
            <>Couldn&apos;t draft <span className="m-mono">{state.view}</span> — retrying / see artifact.</>
          ) : currentPending ? (
            <>Drafting <span className="m-mono">{state.view}</span> from your idea…</>
          ) : (
            <>On <span className="m-mono">{state.view}</span>.</>
          )}
        </p>
        <p className="m-feed-line m-mono m-muted">{doneCount}/{views.length} artifacts drafted</p>
      </div>
      {showNudge && <CodyNudge view={state.view} nudge={nudge} />}
      {nudgeState === 'accepted' && nudge && (
        <p className="m-feed-line m-nudge-done">✓ Woven in. {nudge.prim} is part of this company now.</p>
      )}
    </div>
  )
}
