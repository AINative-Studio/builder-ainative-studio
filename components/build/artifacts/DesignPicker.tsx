'use client'

/**
 * DesignPicker (#591, made a real tracked artifact 2026-09-09) — the first
 * real entry in BOTH APP_VIEWS and COMPANY_VIEWS. Mirrors artifacts/Wedge.tsx's
 * exact interrupt-view pattern: shown by useAutoplay when 'design' is next in
 * the sequence, hands the wheel to the founder, and resumes once they pick a
 * system (PICK_DESIGN_SYSTEM) or explicitly skip (SKIP_DESIGN_SYSTEM).
 *
 * Real bug this fixes (customer-reported, 2026-09-09): the picker used to be
 * a screen shown BEFORE Intake, invisible in the top stepper, the artifact
 * checklist, and APP_VIEWS itself — the founder had no way to see the design
 * choice as part of "the workflow." It's now a real, tracked, visible step.
 *
 * Extended to the Company track (2026-09-10, Meridian bug): that track's one
 * real generated app (the landing page, via /api/build/company-app ->
 * chat-ws) never had a design system to forward. Both tracks' first real
 * view id after 'design' differs (App: 'brief', Company: 'thesis') — the
 * "Keep building" button below must resolve that per-track, not hardcode
 * the App track's value.
 */

import { useBuild } from '@/contexts/build-context'
import { DESIGN_SYSTEMS, getDesignSystem } from '@/lib/design-systems/catalog'
import type { ArtifactView } from '@/lib/build/state'

const NEXT_VIEW_AFTER_DESIGN: Record<'app' | 'company', ArtifactView> = {
  app: 'brief',
  company: 'thesis',
}

export function DesignPicker() {
  const { state, dispatch, goView } = useBuild()

  if (state.designStepDone) {
    const chosen = state.designSystemId ? getDesignSystem(state.designSystemId) : undefined
    return (
      <div className="m-wedge-confirm">
        <p>
          <span className="m-glyph">◇</span>{' '}
          {chosen
            ? <>Building {state.companyName || 'your app'} in <strong>{chosen.name}</strong> — {chosen.direction.toLowerCase()}.</>
            : <>Got it — I&apos;ll pick a look that fits your idea.</>}
        </p>
        <button className="btn-primary" onClick={() => goView(NEXT_VIEW_AFTER_DESIGN[state.track])}>Keep building →</button>
      </div>
    )
  }

  const choose = (id: string) => {
    dispatch({ type: 'PICK_DESIGN_SYSTEM', designSystemId: id })
  }
  const skip = () => {
    dispatch({ type: 'SKIP_DESIGN_SYSTEM' })
  }

  return (
    <div className="m-wedge-interrupt">
      <p className="m-mono m-wedge-eyebrow"><span className="m-glyph">◇</span> Cody · a note before we go on</p>
      <h1 className="m-artifact m-wedge-h">Pick a look for {state.companyName || 'your app'}.</h1>
      <p className="m-wedge-sub">
        Every system below is a complete, real design language — colors, fonts, spacing, and
        components — that I&apos;ll build your app in. Not sure? Skip this and I&apos;ll pick one that fits your idea.
      </p>
      <div className="m-wedge-opts" data-testid="design-picker-cards">
        {DESIGN_SYSTEMS.map((sys) => (
          <button
            key={sys.id}
            type="button"
            className="m-wedge-opt"
            data-testid={`design-system-${sys.id}`}
            onClick={() => choose(sys.id)}
            style={{ background: sys.palette.bg, borderColor: sys.palette.accent }}
          >
            <span className="m-wedge-opt-t" style={{ fontFamily: sys.fonts.heading.family, color: sys.palette.text }}>
              {sys.name}
            </span>
            <span className="m-wedge-opt-p" style={{ color: sys.palette.text, opacity: 0.75 }}>
              {sys.direction}
            </span>
            <span aria-hidden style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <i style={{ width: 16, height: 16, borderRadius: sys.radius, background: sys.palette.accent, display: 'inline-block' }} />
              <i style={{ width: 16, height: 16, borderRadius: sys.radius, background: sys.palette.accent2, display: 'inline-block' }} />
            </span>
          </button>
        ))}
      </div>
      <button className="btn-primary" data-testid="design-picker-skip" onClick={skip} style={{ marginTop: 20 }}>
        Skip — let Cody pick →
      </button>
    </div>
  )
}
