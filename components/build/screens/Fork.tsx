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
  const { dispatch, pickTrack } = useBuild()
  // Fork is only ever reached as a "start fresh" entry point (MyCompanies'
  // "+ New company", the landing funnel, or "Back" from Intake) — never a
  // resume path. Without this, any idea text left over from a PREVIOUS
  // build earlier in the same session (e.g. an app the founder built last
  // week) silently reappears pre-filled in Intake's textarea for a
  // brand-new company, since PICK_TRACK itself doesn't touch state.idea
  // (it can't — BuildStart's "Surprise me" flow relies on PICK_TRACK
  // leaving an idea it just set via SET_IDEA alone). Confirmed live during
  // Company-track QA (2026-10-09).
  const choose = (track: 'app' | 'company') => {
    dispatch({ type: 'SET_IDEA', idea: '' })
    pickTrack(track)
  }
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
          onClick={() => choose('app')} onKeyDown={(e) => e.key === 'Enter' && choose('app')}>
          <h2 className="m-artifact">Build an App</h2>
          <p>Turn an idea into a working intelligent product.</p>
          <div className="m-chip-trail">
            {APP_VIEWS.slice(0, 6).map((v) => <span key={v} className="m-chip">{v}</span>)}
            <span className="m-chip">…</span>
          </div>
          <button className="btn-primary" onClick={(e) => { e.stopPropagation(); choose('app') }}>Build an App →</button>
        </div>

        <div className="m-fork-card" data-track="company" role="button" tabIndex={0}
          onClick={() => choose('company')} onKeyDown={(e) => e.key === 'Enter' && choose('company')}>
          <h2 className="m-artifact">Build a Company</h2>
          <p>Turn a problem into an operating AI-native business.</p>
          <div className="m-chip-trail">
            {COMPANY_VIEWS.map((v) => <span key={v} className="m-chip">{v}</span>)}
          </div>
          <button className="btn-primary" onClick={(e) => { e.stopPropagation(); choose('company') }}>Build a Company →</button>
        </div>
      </div>

      {/* 3-step "what this does" strip (#65) — visible before auth, after the cards. */}
      <ValueStrip />

      <LiveProof />
    </div>
  )
}
