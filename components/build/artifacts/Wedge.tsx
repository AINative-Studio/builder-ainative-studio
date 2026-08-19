'use client'

/** Initial Wedge (#224, §16) — dark full-bleed interrupt, narrow-the-wedge challenge. */

import { useBuild } from '@/contexts/build-context'
import type { WedgeChoice } from '@/lib/build/state'

const OPTIONS: Array<{ v: WedgeChoice; t: string; pitch: string }> = [
  { v: 'support', t: 'Customer support', pitch: 'Sharpest pain, fastest proof — same questions asked daily.' },
  { v: 'eng', t: 'Engineering onboarding', pitch: 'High willingness to pay, but slower sales cycle.' },
  { v: 'sales', t: 'Sales enablement', pitch: 'Big budgets, but crowded with incumbents.' },
]

export function Wedge() {
  const { state, dispatch, goView } = useBuild()

  if (state.wedgePicked) {
    const label = OPTIONS.find((o) => o.v === state.wedgePicked)?.t
    return (
      <div className="m-wedge-confirm">
        <p><span className="m-glyph">◇</span> Sharper. I&apos;ll re-scope the wedge to <strong>{label}</strong> and update Positioning, Business Model, and the 30-Day Plan.</p>
        <button className="btn-primary" onClick={() => goView('businessModel')}>Keep building →</button>
      </div>
    )
  }

  return (
    <div className="m-wedge-interrupt">
      <p className="m-mono m-wedge-eyebrow"><span className="m-glyph">◇</span> Cody · a note before we go on</p>
      <h1 className="m-artifact m-wedge-h">Your wedge covers three customer types with different buying processes.</h1>
      <p className="m-wedge-sub">Pick one entry point and the rest of the plan gets sharper. Engineering, sales, and support buy differently — pricing, messaging, and the 30-day plan would each have to hedge three ways otherwise.</p>
      <div className="m-wedge-opts">
        {OPTIONS.map((o) => (
          <button key={o.v} className="m-wedge-opt" onClick={() => dispatch({ type: 'PICK_WEDGE', choice: o.v })}>
            <span className="m-wedge-opt-t">{o.t}</span>
            <span className="m-wedge-opt-p">{o.pitch}</span>
            <span className="m-wedge-opt-arrow">→</span>
          </button>
        ))}
      </div>
    </div>
  )
}
