'use client'

/** Cody nudge card (#221) — amber, first-person, accept/dismiss. 05-COMPONENTS. */

import { useBuild } from '@/contexts/build-context'
import type { PrimitiveNudge } from '@/lib/build/primitives'
import type { ArtifactView } from '@/lib/build/state'

export function CodyNudge({ view, nudge }: { view: string; nudge: PrimitiveNudge }) {
  const { dispatch } = useBuild()
  const accept = () => {
    dispatch({ type: 'NUDGE', view, state: 'accepted' })
    if (nudge.to) setTimeout(() => dispatch({ type: 'GOTO_VIEW', view: nudge.to as ArtifactView }), 500)
  }
  return (
    <div className="m-nudge">
      <div className="m-nudge-head m-mono"><span className="m-glyph">◇</span> Cody suggests · {nudge.prim}</div>
      <p className="m-nudge-body">{nudge.text}</p>
      <div className="m-nudge-foot">
        <button className="m-nudge-accept" onClick={accept}>{nudge.cta}</button>
        <button className="btn-ghost" onClick={() => dispatch({ type: 'NUDGE', view, state: 'dismissed' })}>Not now</button>
      </div>
    </div>
  )
}
