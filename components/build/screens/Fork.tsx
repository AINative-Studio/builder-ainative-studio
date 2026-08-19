'use client'

/** Fork screen (#222) — pick App Track vs Company Track. Copy verbatim from 04-SCREENS §1. */

import { useBuild } from '@/contexts/build-context'
import { LiveProof } from '@/components/build/LiveProof'
import { APP_VIEWS, COMPANY_VIEWS } from '@/lib/build/state'

export function Fork() {
  const { pickTrack } = useBuild()
  return (
    <div className="modernist m-fork">
      <span className="m-eyebrow">AINATIVE BUILDER</span>
      <h1 className="m-h1">Don&apos;t build from scratch.</h1>
      <p className="m-sub">Compose AINative artifacts into intelligent products and AI-native companies.</p>
      <p className="m-cody-line">
        <span className="m-glyph">◇</span> Meet Cody — your technical co-founder. You bring the idea; Cody builds and runs it.
      </p>

      <div className="m-fork-cards">
        <div className="m-fork-card" data-track="app" role="button" tabIndex={0}
          onClick={() => pickTrack('app')} onKeyDown={(e) => e.key === 'Enter' && pickTrack('app')}>
          <h2 className="m-artifact">Build an App</h2>
          <p>Turn an idea into a working intelligent product.</p>
          <div className="m-chip-trail">
            {APP_VIEWS.slice(0, 6).map((v) => <span key={v} className="m-chip">{v}</span>)}
            <span className="m-chip">…</span>
          </div>
          <button className="btn-primary">Build an App →</button>
        </div>

        <div className="m-fork-card" data-track="company" role="button" tabIndex={0}
          onClick={() => pickTrack('company')} onKeyDown={(e) => e.key === 'Enter' && pickTrack('company')}>
          <h2 className="m-artifact">Build a Company</h2>
          <p>Turn a problem into an operating AI-native business.</p>
          <div className="m-chip-trail">
            {COMPANY_VIEWS.map((v) => <span key={v} className="m-chip">{v}</span>)}
          </div>
          <button className="btn-primary">Build a Company →</button>
        </div>
      </div>

      <LiveProof />
    </div>
  )
}
