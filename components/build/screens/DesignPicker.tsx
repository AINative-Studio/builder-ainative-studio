'use client'

/**
 * DesignPicker (#591) — the new build-flow step where a founder picks one of
 * the imported design systems (lib/design-systems/catalog.ts) before Cody
 * generates their app. Reached from Fork's PICK_TRACK (lib/build/state.ts),
 * before Intake — "pick your look, then describe your idea."
 *
 * Picking a system dispatches PICK_DESIGN_SYSTEM, then routes to 'intake'
 * exactly as Fork used to route directly. Skipping does the same without a
 * choice — designSystemId stays '' and codegen falls back to today's
 * automatic selectTheme() behavior (lib/theme-system.ts), so a founder who
 * skips this screen sees ZERO behavior change from before this feature shipped.
 */

import { useBuild } from '@/contexts/build-context'
import { DESIGN_SYSTEMS } from '@/lib/design-systems/catalog'

export function DesignPicker() {
  const { state, dispatch } = useBuild()

  const choose = (id: string) => {
    dispatch({ type: 'PICK_DESIGN_SYSTEM', designSystemId: id })
    dispatch({ type: 'GOTO_SCREEN', screen: 'intake' })
  }

  const skip = () => {
    dispatch({ type: 'GOTO_SCREEN', screen: 'intake' })
  }

  return (
    <div className="modernist m-intake" data-track={state.track}>
      <button className="m-back" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'fork' })}>← Back</button>
      <p className="m-cody-line"><span className="m-glyph">◇</span> Cody · your technical co-founder</p>
      <h1 className="m-h1">Pick a look for {state.track === 'company' ? 'your company' : 'your app'}.</h1>
      <p className="m-sub">
        Every system below is a complete, real design language — colors, fonts, spacing, and
        components — that Cody will build your {state.track === 'company' ? 'company' : 'app'} in.
        Not sure? Skip this and Cody picks one that fits your idea.
      </p>

      <div className="m-fork-cards" data-testid="design-picker-cards">
        {DESIGN_SYSTEMS.map((sys) => (
          <button
            key={sys.id}
            type="button"
            className="m-fork-card"
            data-testid={`design-system-${sys.id}`}
            onClick={() => choose(sys.id)}
            style={{
              background: sys.palette.bg,
              color: sys.palette.text,
              borderTopColor: sys.palette.accent,
              textAlign: 'left',
            }}
          >
            <h2 style={{ fontFamily: sys.fonts.heading.family, color: sys.palette.text }}>{sys.name}</h2>
            <p style={{ color: sys.palette.text, opacity: 0.75 }}>{sys.direction}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <span
                aria-hidden
                style={{ width: 20, height: 20, borderRadius: sys.radius, background: sys.palette.accent, display: 'inline-block' }}
              />
              <span
                aria-hidden
                style={{ width: 20, height: 20, borderRadius: sys.radius, background: sys.palette.accent2, display: 'inline-block' }}
              />
              <span
                aria-hidden
                style={{ width: 20, height: 20, borderRadius: sys.radius, background: sys.palette.surface, border: `1px solid ${sys.palette.text}33`, display: 'inline-block' }}
              />
            </div>
            {sys.brandBound && sys.primitive && (
              <p className="m-mono" style={{ marginTop: 10, fontSize: 11, opacity: 0.6 }}>
                Embodies {sys.primitive}
              </p>
            )}
          </button>
        ))}
      </div>

      <button className="btn-primary" data-testid="design-picker-skip" onClick={skip} style={{ marginTop: 32 }}>
        Skip — let Cody pick →
      </button>
    </div>
  )
}
