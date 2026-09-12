'use client'

/**
 * Initial Wedge (#224, §16) — dark full-bleed interrupt, narrow-the-wedge challenge.
 *
 * #668: this used to present 3 hardcoded, always-B2B-SaaS options ("Customer
 * support" / "Engineering onboarding" / "Sales enablement") regardless of the
 * founder's actual idea — confirmed live: submitting a consumer hot-sauce
 * subscription box idea still produced the identical 3 B2B choices, none of
 * which made sense. The real fix isn't a bigger hardcoded menu — it's that a
 * genuinely idea-aware wedge prompt (ARTIFACT_PROMPTS.wedge) already existed
 * and was already correct, it just was NEVER CALLED for this view (useAutoplay
 * treats 'wedge' as an interrupt view, not a generated one, so the artifact
 * fetch never fired). Now shows Cody's real, idea-derived recommendation
 * (drafted via useAutoplay's real /api/build/artifact call) with a genuine
 * confirm/regenerate choice, instead of fabricating multiple fake options to
 * preserve the old picker's shape.
 */

import { useBuild } from '@/contexts/build-context'

export function Wedge() {
  const { state, dispatch, goView } = useBuild()

  if (state.wedgePicked) {
    const draft = state.wedgeDraft
    return (
      <div className="m-wedge-confirm">
        <p>
          <span className="m-glyph">◇</span> Sharper.{draft ? <> I&apos;ll re-scope Positioning, Business Model, and the 30-Day Plan around <strong>{draft.segment}</strong>.</> : ' Locking that in.'}
        </p>
        <button className="btn-primary" onClick={() => goView('businessModel')}>Keep building →</button>
      </div>
    )
  }

  if (state.wedgeDraftError) {
    return (
      <div className="m-wedge-interrupt">
        <p className="m-mono m-wedge-eyebrow"><span className="m-glyph">◇</span> Cody · a note before we go on</p>
        <h1 className="m-artifact m-wedge-h">I couldn&apos;t draft a wedge just yet.</h1>
        <p className="m-wedge-sub">{state.wedgeDraftError}</p>
        <button className="btn-primary" onClick={() => dispatch({ type: 'WEDGE_DRAFT_RETRY' })}>Try again →</button>
      </div>
    )
  }

  if (!state.wedgeDraft) {
    return (
      <div className="m-wedge-interrupt">
        <p className="m-mono m-wedge-eyebrow"><span className="m-glyph">◇</span> Cody · a note before we go on</p>
        <h1 className="m-artifact m-wedge-h">Finding the narrowest entry point for your idea…</h1>
        <p className="m-wedge-sub">Drafting the wedge — the single sharpest place to win first.</p>
      </div>
    )
  }

  const draft = state.wedgeDraft
  return (
    <div className="m-wedge-interrupt">
      <p className="m-mono m-wedge-eyebrow"><span className="m-glyph">◇</span> Cody · a note before we go on</p>
      <h1 className="m-artifact m-wedge-h">{draft.headline}</h1>
      <p className="m-wedge-sub">
        <strong>Segment:</strong> {draft.segment}
      </p>
      <p className="m-wedge-sub">
        <strong>Motion:</strong> {draft.motion}
      </p>
      <p className="m-wedge-sub">
        <strong>Proof in 30 days:</strong> {draft.proofPlan}
      </p>
      <div className="m-wedge-opts">
        <button className="m-wedge-opt" onClick={() => dispatch({ type: 'PICK_WEDGE' })}>
          <span className="m-wedge-opt-t">This is the right wedge</span>
          <span className="m-wedge-opt-p">Narrow the plan around it.</span>
          <span className="m-wedge-opt-arrow">→</span>
        </button>
        <button className="m-wedge-opt" onClick={() => dispatch({ type: 'WEDGE_DRAFT_RETRY' })}>
          <span className="m-wedge-opt-t">Try a different angle</span>
          <span className="m-wedge-opt-p">Redraft the wedge from the same idea.</span>
          <span className="m-wedge-opt-arrow">↻</span>
        </button>
      </div>
    </div>
  )
}
