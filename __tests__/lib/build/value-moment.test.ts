import { describe, it, expect } from 'vitest'
import {
  ARTIFACT_MAX_TOKENS,
  APP_GEN_MAX_TOKENS,
  PLAN_TOKEN_ALLOWANCES,
  estimateSprintTokens,
  defaultSprintEstimate,
  sprintShareOfPlan,
  sprintCostLine,
  buildsRemainingLine,
  decideLimitAction,
  shouldShowMvpUpsell,
  pricingFraming,
} from '@/lib/build/value-moment'

/**
 * lib/build/value-moment — the Greg Rose conversion cluster (#310/#311/#320).
 * Pure sequencing/gating/cost logic: no I/O, no mocks.
 */

describe('estimateSprintTokens (#320 GR-11)', () => {
  it('computes from the REAL pipeline caps (artifact 1600, app pass 16000)', () => {
    const e = estimateSprintTokens({ proseArtifacts: 10, systems: 4, appBuildPasses: 2 })
    expect(e.breakdown.artifacts).toBe(10 * ARTIFACT_MAX_TOKENS)
    expect(e.breakdown.appBuild).toBe(2 * APP_GEN_MAX_TOKENS)
    expect(e.breakdown.systems).toBe(4 * ARTIFACT_MAX_TOKENS)
    // 16,000 + 32,000 + 6,400 = 54,400 → rounded UP to 55,000
    expect(e.tokens).toBe(55_000)
    expect(e.isEstimate).toBe(true)
  })

  it('rounds UP to the nearest 1,000 — never understates', () => {
    // 1 artifact (1600) + 1 pass (16000) = 17,600 → 18,000
    const e = estimateSprintTokens({ proseArtifacts: 1, systems: 0, appBuildPasses: 1 })
    expect(e.tokens).toBe(18_000)
  })

  it('defaults to 2 app build passes (build + repair)', () => {
    const e = estimateSprintTokens({ proseArtifacts: 0, systems: 0 })
    expect(e.breakdown.appBuild).toBe(2 * APP_GEN_MAX_TOKENS)
  })

  it('clamps negative/fractional inputs sanely (min 1 pass, min 0 counts)', () => {
    const e = estimateSprintTokens({ proseArtifacts: -3, systems: 2.9, appBuildPasses: 0 })
    expect(e.breakdown.artifacts).toBe(0)
    expect(e.breakdown.systems).toBe(2 * ARTIFACT_MAX_TOKENS)
    expect(e.breakdown.appBuild).toBe(1 * APP_GEN_MAX_TOKENS) // min 1 pass
  })

  it('defaultSprintEstimate is the 10-artifact / 4-system / 2-pass sprint', () => {
    expect(defaultSprintEstimate().tokens).toBe(55_000)
  })
})

describe('sprintShareOfPlan', () => {
  it('expresses the sprint as a whole-percent share of the plan allowance (rounded up)', () => {
    // 55,000 / 1,000,000 = 5.5% → 6%
    expect(sprintShareOfPlan(55_000, 'pro')).toBe(6)
    expect(sprintShareOfPlan(55_000, 'business')).toBe(2) // 1.1% → 2
  })

  it('returns null for plans with no published token allowance (build-metered tiers)', () => {
    expect(sprintShareOfPlan(55_000, 'starter')).toBeNull()
    expect(sprintShareOfPlan(55_000, 'hobbyist')).toBeNull()
    expect(sprintShareOfPlan(55_000, '')).toBeNull()
  })

  it('returns null for a non-positive token count', () => {
    expect(sprintShareOfPlan(0, 'pro')).toBeNull()
  })
})

describe('sprintCostLine — the explicit "this sprint costs N" figure', () => {
  it('states the token figure, the plan share, and labels it an estimate', () => {
    const line = sprintCostLine(defaultSprintEstimate(), { id: 'pro', name: 'Pro' })
    expect(line).toContain('≈55,000 tokens')
    expect(line).toContain('6%')
    expect(line).toContain("Pro's 1M-token monthly allowance")
    expect(line).toContain('estimate')
  })

  it('never fabricates a share for a plan without an allowance — still honest', () => {
    const line = sprintCostLine(defaultSprintEstimate(), { id: 'starter', name: 'Starter' })
    expect(line).toContain('≈55,000 tokens')
    expect(line).toContain('estimate')
    expect(line).not.toContain('%')
  })

  it('uses the published allowances (same figures as the pricing tiers)', () => {
    expect(PLAN_TOKEN_ALLOWANCES.pro).toBe(1_000_000)
    expect(PLAN_TOKEN_ALLOWANCES.business).toBe(5_000_000)
    expect(PLAN_TOKEN_ALLOWANCES.enterprise).toBe(20_000_000)
  })
})

describe('buildsRemainingLine — real credits API numbers only', () => {
  it('renders used-of-limit from the API response', () => {
    expect(buildsRemainingLine({ used: 1, limit: 3, unlimited: false }))
      .toBe("You've used 1 of 3 free builds.")
  })

  it('caps used at the limit (over-counted store never shows 4 of 3)', () => {
    expect(buildsRemainingLine({ used: 5, limit: 3, unlimited: false }))
      .toBe("You've used 3 of 3 free builds.")
  })

  it('is empty for unlimited plans, null status, or malformed shapes — never fabricates', () => {
    expect(buildsRemainingLine(null)).toBe('')
    expect(buildsRemainingLine({ unlimited: true, used: 0, limit: -1 })).toBe('')
    expect(buildsRemainingLine({ used: 1 })).toBe('')
    expect(buildsRemainingLine({ used: 1, limit: 0 })).toBe('')
  })
})

describe('decideLimitAction (#311 GR-02 — no card before value)', () => {
  it('builds normally when the limit is not reached', () => {
    expect(decideLimitAction({ limitReached: false, sawPreview: false })).toBe('build')
    expect(decideLimitAction({ limitReached: false, sawPreview: true })).toBe('build')
  })

  it('NEVER routes to pricing before the founder has seen a working preview', () => {
    expect(decideLimitAction({ limitReached: true, sawPreview: false })).toBe('build')
  })

  it('routes to pricing at the limit once the value moment has happened', () => {
    expect(decideLimitAction({ limitReached: true, sawPreview: true })).toBe('pricing')
  })
})

describe('shouldShowMvpUpsell (#320 — MVP first, then the offer)', () => {
  it('shows only when the MVP is done AND the preview actually rendered', () => {
    expect(shouldShowMvpUpsell({ builtMVP: true, previewStatus: 'ready' })).toBe(true)
  })

  it('never shows over a skeleton, error, or mid-generation state', () => {
    expect(shouldShowMvpUpsell({ builtMVP: true, previewStatus: 'generating' })).toBe(false)
    expect(shouldShowMvpUpsell({ builtMVP: true, previewStatus: 'error' })).toBe(false)
    expect(shouldShowMvpUpsell({ builtMVP: true, previewStatus: 'idle' })).toBe(false)
  })

  it('never shows before the MVP is complete', () => {
    expect(shouldShowMvpUpsell({ builtMVP: false, previewStatus: 'ready' })).toBe(false)
  })
})

describe('pricingFraming (#310/#311 — honest pay-gate copy)', () => {
  it('claims "your prototype works" only after the value moment', () => {
    const f = pricingFraming({ sawPreview: true, companyName: 'Acme', appSub: 'acme' })
    expect(f.headline).toBe('Your prototype works. Let’s make it real.')
    expect(f.sub).toContain('Acme')
    expect(f.sub).toContain('builder.ainative.studio/build/acme')
    expect(f.showSeePreviewFirst).toBe(false)
  })

  it('offers the preview FIRST when a build exists but was never seen working', () => {
    const f = pricingFraming({ sawPreview: false, companyName: 'Acme', appSub: 'acme', hasBuild: true })
    expect(f.headline).toBe('See your app work first.')
    expect(f.showSeePreviewFirst).toBe(true)
    expect(f.sub).not.toContain('prototype works')
  })

  it('uses neutral plan-browsing copy when there is no build at all', () => {
    const f = pricingFraming({ sawPreview: false })
    expect(f.headline).toBe('Pick how far we go.')
    expect(f.showSeePreviewFirst).toBe(false)
    expect(f.sub).toContain('no card required')
  })

  it('falls back to generic name/slug when company fields are empty', () => {
    const f = pricingFraming({ sawPreview: true })
    expect(f.sub).toContain('I built it for free')
    expect(f.sub).toContain('/build/your-app')
  })
})
