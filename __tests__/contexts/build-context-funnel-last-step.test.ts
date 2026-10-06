import { describe, it, expect } from 'vitest'
import { isLastStepReached } from '@/contexts/build-context'

/**
 * #BLD-06.12 — the pre-existing build_completed effect (contexts/
 * build-context.tsx) only ever checked state.builtCompany, a real,
 * pre-existing gap that silently never fired on the App track (which uses
 * state.builtMVP instead). isLastStepReached is the pure, testable
 * decision this effect should gate on, following this file's own
 * established pattern (canResumeActiveBuild, computeSyncedUrl) of
 * extracting effect decisions as pure functions — mounting the full
 * BuildProvider OOMs jsdom via useAutoplay (see
 * build-context-url-sync-mount-race.test.ts's note), so this is
 * unit-tested directly, never through a full provider mount.
 */
describe('isLastStepReached (#BLD-06.12)', () => {
  it('is true for the Company track once builtCompany is true', () => {
    expect(isLastStepReached({ track: 'company', builtCompany: true, builtMVP: false })).toBe(true)
  })

  it('is false for the Company track while builtCompany is still false', () => {
    expect(isLastStepReached({ track: 'company', builtCompany: false, builtMVP: false })).toBe(false)
  })

  it('is true for the App track once builtMVP is true (the real gap — builtCompany never applies here)', () => {
    expect(isLastStepReached({ track: 'app', builtCompany: false, builtMVP: true })).toBe(true)
  })

  it('is false for the App track while builtMVP is still false, even if builtCompany is somehow true', () => {
    expect(isLastStepReached({ track: 'app', builtCompany: true, builtMVP: false })).toBe(false)
  })
})
