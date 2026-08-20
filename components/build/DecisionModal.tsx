'use client'

/**
 * Decision modal (#207 · 04-SCREENS §3) — Cody pauses the build and asks the
 * user a call that genuinely changes the product (e.g. data-privacy posture).
 * Renders when state.paused && state.pendingQ. Picking an option dispatches
 * ANSWER_Q (which clears paused) and the autoplay engine resumes.
 *
 * Per spec: the question as H2, a supporting line, 2–3 full-width option
 * buttons — never a text field for this kind of call.
 */

import { useBuild } from '@/contexts/build-context'

export function DecisionModal() {
  const { state, dispatch } = useBuild()
  const q = state.pendingQ
  if (!state.paused || !q) return null

  const pick = (value: string) => {
    // The one App-track decision is the privacy posture; key it so the Data
    // Model / Memory Policy can reflect it. Generic key falls back to 'answer'.
    const key = q.q.toLowerCase().includes('data') ? 'privacy' : 'answer'
    dispatch({ type: 'ANSWER_Q', key, value })
  }

  return (
    <div className="m-modal-scrim" role="dialog" aria-modal="true" aria-label="Cody needs a direction">
      <div className="m-modal m-formin">
        <p className="m-mono m-modal-eyebrow"><span className="m-glyph">◇</span> Cody needs a direction</p>
        <h2 className="m-artifact m-modal-h">{q.q}</h2>
        <p className="m-sub">{q.sub}</p>
        <div className="m-modal-opts">
          {q.opts.map((o) => (
            <button key={o.v} className="m-modal-opt" onClick={() => pick(o.v)}>
              {o.t}
            </button>
          ))}
        </div>
        <p className="m-mono m-modal-foot">Cody paused the build until you decide.</p>
      </div>
    </div>
  )
}
