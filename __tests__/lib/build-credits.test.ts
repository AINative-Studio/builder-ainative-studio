import { describe, it, expect } from 'vitest'
import {
  buildLimitForTier,
  getBuildCreditStatus,
  FREE_BUILD_LIMIT,
  STARTER_BUILD_LIMIT,
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
