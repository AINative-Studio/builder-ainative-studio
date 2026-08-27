'use client'

/** Fork screen (#222 / #65) — pick App Track vs Company Track. Sharpened value prop. */

import { useBuild } from '@/contexts/build-context'
import { LiveProof } from '@/components/build/LiveProof'
import { LiveTicker } from '@/components/build/LiveTicker'
import { MenuChip } from '@/components/build/MenuChip'
import { ValueStrip } from '@/components/build/ValueStrip'
import { FRONT_DOOR_VALUE_LINE } from '@/lib/build/front-door-value'
import { APP_VIEWS, COMPANY_VIEWS } from '@/lib/build/state'

export function Fork() {
  const { pickTrack } = useBuild()
  return (
    <div className="modernist m-fork">
      <LiveTicker />
      {/* Polsia-parity account MENU, upper-right on the fork too (not just the
          workspace act-bar) — a signed-in founder always has their menu. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="m-eyebrow">AINATIVE BUILDER</span>
        <MenuChip />
      </div>
      <h1 className="m-h1">Don&apos;t build from scratch.</h1>
      {/* Value prop (#65): one plain line the target persona gets instantly — before any auth. */}
      <p className="m-value-line" data-testid="front-door-value-line">{FRONT_DOOR_VALUE_LINE}</p>
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
          <button className="btn-primary" onClick={(e) => { e.stopPropagation(); pickTrack('app') }}>Build an App →</button>
        </div>

        <div className="m-fork-card" data-track="company" role="button" tabIndex={0}
          onClick={() => pickTrack('company')} onKeyDown={(e) => e.key === 'Enter' && pickTrack('company')}>
          <h2 className="m-artifact">Build a Company</h2>
          <p>Turn a problem into an operating AI-native business.</p>
          <div className="m-chip-trail">
            {COMPANY_VIEWS.map((v) => <span key={v} className="m-chip">{v}</span>)}
          </div>
          <button className="btn-primary" onClick={(e) => { e.stopPropagation(); pickTrack('company') }}>Build a Company →</button>
        </div>
      </div>

      {/* 3-step "what this does" strip (#65) — visible before auth, after the cards. */}
      <ValueStrip />

      <LiveProof />
    </div>
  )
}
