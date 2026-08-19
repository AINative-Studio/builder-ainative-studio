'use client'

/** Running Preview (#223, §14) — browser-frame w/ the generated product + Make-it-real banner. */

import { useBuild } from '@/contexts/build-context'

export function Preview() {
  const { state, dispatch } = useBuild()
  return (
    <>
      <div className="m-live-chip m-mono"><span className="m-live-dot" /> Live in production</div>

      {state.builtMVP && (
        <div className="m-cody-banner">
          <p><span className="m-glyph">◇</span> Your MVP is live in the sandbox. Ready to put it in front of real users and build the company?</p>
          <button className="btn-primary" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'pricing' })}>Make it real →</button>
        </div>
      )}

      <div className="m-browser">
        <div className="m-browser-chrome m-mono">
          <span className="m-browser-dots"><i /><i /><i /></span>
          <span className="m-browser-url">{state.appSub || 'your-app'}.ainative.studio</span>
        </div>
        <div className="m-browser-body">
          <div className="m-preview-search">
            <input className="m-preview-input" placeholder="Ask the company anything…" readOnly />
            <button className="btn-primary">Ask</button>
          </div>
          <div className="m-preview-answer">
            <p>Q2 onboarding docs live in the Ops Drive folder, last updated Tuesday.</p>
            <div className="m-cite-chips"><span className="m-chip">Ops Handbook</span><span className="m-chip">Slack #ops</span></div>
          </div>
        </div>
      </div>
    </>
  )
}
