import { describe, it, expect } from 'vitest'
import { normalizeTier, TIER_LIMITS } from '@/lib/ainative/plan'

/**
 * Plan-tier normalization + limits must mirror core get_tier_limits so the
 * builder enforces the SAME AINative rules (free/hobbyist: 1 workspace, 3
 * projects) as ainative.studio.
 */
describe('plan tier limits (mirror of core get_tier_limits)', () => {
  it('free/basic/starter/trial all resolve to hobbyist', () => {
    for (const p of ['free', 'basic', 'starter', 'trial', 'Free Tier', 'HOBBYIST', '']) {
      expect(normalizeTier(p)).toBe('hobbyist')
    }
  })

  it('null/undefined default to hobbyist (never over-grant)', () => {
    expect(normalizeTier(undefined)).toBe('hobbyist')
    expect(normalizeTier(null)).toBe('hobbyist')
  })

  it('known paid tiers pass through', () => {
    expect(normalizeTier('pro')).toBe('pro')
    expect(normalizeTier('scale')).toBe('scale')
    expect(normalizeTier('enterprise')).toBe('enterprise')
  })

  it('unknown tier falls back to hobbyist', () => {
    expect(normalizeTier('made-up-plan')).toBe('hobbyist')
  })

  it('hobbyist limits match core: 1 workspace, 3 projects', () => {
    expect(TIER_LIMITS.hobbyist).toEqual({ maxWorkspaces: 1, maxProjects: 3 })
    expect(TIER_LIMITS.free).toEqual({ maxWorkspaces: 1, maxProjects: 3 })
  })

  it('pro has 5 workspaces + unlimited projects (-1)', () => {
    expect(TIER_LIMITS.pro).toEqual({ maxWorkspaces: 5, maxProjects: -1 })
  })

  it('enterprise is unlimited (-1)', () => {
    expect(TIER_LIMITS.enterprise).toEqual({ maxWorkspaces: -1, maxProjects: -1 })
  })
})
