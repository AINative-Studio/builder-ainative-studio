import { describe, it, expect } from 'vitest'
import { currentActIndex } from '@/components/build/WorkspaceShell'
import { initialBuildState, type BuildState } from '@/lib/build/state'

/**
 * currentActIndex (2026-09-09) — the top act-bar's "where am I" pointer.
 *
 * Real bug this fixes: the App track's act-bar always showed the same 5
 * acts as the Company track (Idea/Build MVP/Launch/Company/Live) — "Company"
 * on a track that never has one, and no visible "Design" act even after
 * #591 made design a real tracked step. The bar jumped straight from Idea
 * to "Build MVP" the instant generation started, while the founder was
 * still looking at the Design interrupt-view.
 */
function s(overrides: Partial<BuildState>): BuildState {
  return { ...initialBuildState, ...overrides }
}

describe('currentActIndex — App track (Idea=0, Design=1, Build MVP=2, Launch=3, Live=4)', () => {
  it('fork/intake is always Idea(0), regardless of track', () => {
    expect(currentActIndex(s({ screen: 'fork', track: 'app' }))).toBe(0)
    expect(currentActIndex(s({ screen: 'intake', track: 'app' }))).toBe(0)
  })

  it('THE BUG: still on the Design interrupt-view (designStepDone=false) shows Design(1), not Build MVP', () => {
    expect(currentActIndex(s({ screen: 'ws', track: 'app', designStepDone: false }))).toBe(1)
  })

  it('design done, MVP not yet built shows Build MVP(2)', () => {
    expect(currentActIndex(s({ screen: 'ws', track: 'app', designStepDone: true, builtMVP: false }))).toBe(2)
  })

  it('design done, MVP built shows Launch(3)', () => {
    expect(currentActIndex(s({ screen: 'ws', track: 'app', designStepDone: true, builtMVP: true }))).toBe(3)
  })

  it('pricing screen shows Launch(3) regardless of design/MVP state', () => {
    expect(currentActIndex(s({ screen: 'pricing', track: 'app', designStepDone: false }))).toBe(3)
  })

  it('live screen always shows Live(4)', () => {
    expect(currentActIndex(s({ screen: 'live', track: 'app' }))).toBe(4)
  })
})

describe('currentActIndex — Company track (Idea=0, Build MVP=1, Launch=2, Company=3, Live=4)', () => {
  it('fork/intake is Idea(0)', () => {
    expect(currentActIndex(s({ screen: 'fork', track: 'company' }))).toBe(0)
  })

  // Real gap (customer-reported, Meridian, 2026-09-10): the Company track's
  // one real generated app (the landing page, via company-app -> chat-ws)
  // never had a design system to forward — the track had no Design step at
  // all. It now visits 'design' too (see PICK_TRACK's comment), same as the
  // App track. COMPANY_ACT_LABELS has no dedicated "Design" label, so this
  // reads as still Idea(0) rather than jumping ahead to Build MVP.
  it('still on the Design interrupt-view (designStepDone=false) shows Idea(0), not Build MVP', () => {
    expect(currentActIndex(s({ screen: 'ws', track: 'company', designStepDone: false, builtCompany: false }))).toBe(0)
  })

  it('pricing screen shows Launch(2) regardless of design state', () => {
    expect(currentActIndex(s({ screen: 'pricing', track: 'company', designStepDone: false }))).toBe(2)
  })

  it('design done, company not yet built shows Company(3)', () => {
    expect(currentActIndex(s({ screen: 'ws', track: 'company', designStepDone: true, builtCompany: false }))).toBe(3)
  })

  it('design done, company built shows Live(4) even without screen=live', () => {
    expect(currentActIndex(s({ screen: 'ws', track: 'company', designStepDone: true, builtCompany: true }))).toBe(4)
  })

  it('live screen always shows Live(4)', () => {
    expect(currentActIndex(s({ screen: 'live', track: 'company' }))).toBe(4)
  })
})
