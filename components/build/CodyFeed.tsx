'use client'

/** Cody feed (#220/#221) — left panel, Cody's running commentary + nudge cards. */

import { useBuild } from '@/contexts/build-context'
import { PRIMITIVE_MAP } from '@/lib/build/primitives'
import { CodyNudge } from '@/components/build/CodyNudge'

/**
 * #1308 — the named specialist team (Architect/Backend/Frontend/QA/Security)
 * from components/build/artifacts/Swarm.tsx is narrated only on that one
 * screen today. This feed's generic "✓ {view} — drafted." line is the
 * natural place to extend that narration to a status surface the founder
 * actually keeps seeing — but only honestly: there is no real per-view role
 * mapping for any OTHER artifact view, so this credits the team ONLY for the
 * one view ('swarm') that genuinely IS that step, instead of inventing a
 * mapping for views the swarm cards say nothing about.
 */
const SWARM_VIEW = 'swarm'
const SWARM_ROLE_LINE = 'Architect, Backend, Frontend, QA, and Security'

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
  // #1161: the view is done generating AND has an unactioned nudge — this is
  // exactly the state lib/build/useAutoplay.ts (#1019) deliberately HOLDS
  // autoplay on, so the founder is the next action, not Cody. Mirrors
  // useAutoplay's own hold condition (nudge present, nudgeState undefined,
  // current view done) so the status line and the actual pause always agree.
  const waitingOnNudge = !!nudge && !currentPending && !currentFailed && nudgeState === undefined

  return (
    <div className="m-cody-feed">
      <div className="m-cody-header m-mono"><span className="m-glyph">◇</span> Cody</div>
      <div className="m-feed-lines">
        {/* running commentary — one line per artifact already generated.
            #1308: the 'swarm' step is honestly credited to the real named
            specialist team (see SWARM_ROLE_LINE above) instead of the
            generic "— drafted." line every other view gets. */}
        {views.filter((v) => state.done[v]).map((v) => (
          v === SWARM_VIEW ? (
            <p key={v} className="m-feed-line m-linein">
              ✓ <span className="m-mono">{v}</span> — {SWARM_ROLE_LINE} wrapped up.
            </p>
          ) : (
            <p key={v} className="m-feed-line m-linein">✓ <span className="m-mono">{v}</span> — drafted.</p>
          )
        ))}
        <p className="m-feed-line m-linein">
          {currentFailed ? (
            <>Couldn&apos;t draft <span className="m-mono">{state.view}</span> — retrying / see artifact.</>
          ) : currentPending ? (
            <>Drafting <span className="m-mono">{state.view}</span> from your idea…</>
          ) : waitingOnNudge ? (
            <>Waiting on you — see the suggestion below.</>
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
