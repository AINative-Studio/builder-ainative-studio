import { describe, it, expect } from 'vitest'
import {
  buildLimitForTier,
  getBuildCreditStatus,
  applyValueGuarantee,
  FREE_BUILD_LIMIT,
  STARTER_BUILD_LIMIT,
  type BuildCreditStatus,
} from '@/lib/build/build-credits'

describe('build-credits (#dashboard-ux)', () => {
  it('free/hobbyist tier gets the free build limit', () => {
    expect(buildLimitForTier('hobbyist')).toBe(FREE_BUILD_LIMIT)
    expect(buildLimitForTier('')).toBe(FREE_BUILD_LIMIT) // unknown → free (never over-grant)
    expect(buildLimitForTier('nonsense')).toBe(FREE_BUILD_LIMIT)
  })

  it('starter tier gets the starter build limit', () => {
    expect(buildLimitForTier('starter')).toBe(STARTER_BUILD_LIMIT)
  })

  it('paid tiers are unlimited (-1)', () => {
    for (const t of ['pro', 'scale', 'business', 'enterprise']) {
      expect(buildLimitForTier(t)).toBe(-1)
    }
  })

  it('unlimited tier is always allowed without hitting the store', async () => {
    const s = await getBuildCreditStatus('someone@example.com', 'pro')
    expect(s.unlimited).toBe(true)
    expect(s.allowed).toBe(true)
    expect(s.remaining).toBe(Infinity)
  })

  it('fails OPEN when metering is unconfigured (no ZeroDB) — never hard-blocks', async () => {
    // In the unit env ZeroDB env vars are unset, so getBuildCreditStatus must
    // return allowed:true for a free-tier user rather than blocking the build.
    const s = await getBuildCreditStatus('newuser@example.com', 'hobbyist')
    expect(s.limit).toBe(FREE_BUILD_LIMIT)
    expect(s.allowed).toBe(true) // fail-open
  })
})

describe('applyValueGuarantee (#310/#311 GR-01/GR-02 — one visible build guaranteed)', () => {
  const exhausted: BuildCreditStatus = {
    used: FREE_BUILD_LIMIT, limit: FREE_BUILD_LIMIT, remaining: 0,
    allowed: false, unlimited: false, baseLimit: FREE_BUILD_LIMIT, ecosystemBonus: 0,
  }
  const withinLimit: BuildCreditStatus = {
    used: 1, limit: FREE_BUILD_LIMIT, remaining: FREE_BUILD_LIMIT - 1,
    allowed: true, unlimited: false, baseLimit: FREE_BUILD_LIMIT, ecosystemBonus: 0,
  }

  it('allows an out-of-credits owner who has NEVER reached a working preview', () => {
    const s = applyValueGuarantee(exhausted, false)
    expect(s.allowed).toBe(true)
    expect(s.valueGuarantee).toBe(true)
  })

  it('keeps the limit for an owner who HAS seen a preview (value delivered)', () => {
    const s = applyValueGuarantee(exhausted, true)
    expect(s.allowed).toBe(false)
    expect(s.valueGuarantee).toBeUndefined()
  })

  it('passes an already-allowed status through untouched', () => {
    expect(applyValueGuarantee(withinLimit, false)).toBe(withinLimit)
    expect(applyValueGuarantee(withinLimit, true)).toBe(withinLimit)
  })

  it('does not mutate the input status', () => {
    const before = { ...exhausted }
    applyValueGuarantee(exhausted, false)
    expect(exhausted).toEqual(before)
  })
})
