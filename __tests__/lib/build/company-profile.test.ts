import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * "What Cody has learned" company profile (#693) — synthesizes real
 * founder-Cody ZeroMemory conversation memories into a readable profile,
 * surfaced on the Live dashboard alongside #608's chat handoff summary.
 *
 * Tests the pure regeneration policy directly, and the orchestration layer
 * with mocked zeromemory.ts calls (matching chat-summary.test.ts's
 * established pattern for these lib/build/*.ts modules).
 */

const h = vi.hoisted(() => ({
  reflectOnEntity: vi.fn(),
  getEntityProfile: vi.fn(),
}))
vi.mock('@/lib/agent/zeromemory', () => ({
  reflectOnEntity: h.reflectOnEntity,
  getEntityProfile: h.getEntityProfile,
}))

import {
  shouldReflect,
  ensureCompanyProfile,
  MIN_NEW_MEMORIES_TO_REFLECT,
  MIN_TOTAL_MEMORIES_TO_REFLECT,
} from '@/lib/build/company-profile'

beforeEach(() => {
  h.reflectOnEntity.mockReset()
  h.getEntityProfile.mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('shouldReflect (pure, #693)', () => {
  it('never reflects below the real endpoint\'s own 3-memory floor', () => {
    expect(shouldReflect(0, 0)).toBe(false)
    expect(shouldReflect(MIN_TOTAL_MEMORIES_TO_REFLECT - 1, 0)).toBe(false)
  })

  it('reflects for the first time once the floor is met, even with no prior reflection', () => {
    expect(shouldReflect(MIN_TOTAL_MEMORIES_TO_REFLECT, 0)).toBe(true)
  })

  it('does NOT re-reflect when fewer than MIN_NEW_MEMORIES_TO_REFLECT new memories have accumulated', () => {
    expect(shouldReflect(10, 10 + MIN_NEW_MEMORIES_TO_REFLECT - 1 - MIN_NEW_MEMORIES_TO_REFLECT)).toBe(false)
    // Explicit: last reflected at 10, only 1 new memory since (below the bar of 3).
    expect(shouldReflect(11, 10)).toBe(false)
  })

  it('re-reflects once exactly MIN_NEW_MEMORIES_TO_REFLECT new memories have accumulated', () => {
    expect(shouldReflect(10 + MIN_NEW_MEMORIES_TO_REFLECT, 10)).toBe(true)
  })
})

describe('ensureCompanyProfile (#693)', () => {
  it('returns null immediately for an empty scopeKey, without calling the API', async () => {
    const result = await ensureCompanyProfile('')
    expect(result).toBeNull()
    expect(h.getEntityProfile).not.toHaveBeenCalled()
  })

  it('returns null when there is no profile at all and no memories yet (a genuinely brand-new company)', async () => {
    h.getEntityProfile.mockResolvedValue({
      entityId: 'owner::acme', preferences: [], behaviors: [], facts: [], summary: null, memoryCount: 0, lastInteraction: null,
    })
    const result = await ensureCompanyProfile('owner::acme')
    expect(result).toBeNull()
    expect(h.reflectOnEntity).not.toHaveBeenCalled()
  })

  it('does not reflect yet when below the 3-memory floor, but still no crash/fabrication', async () => {
    h.getEntityProfile.mockResolvedValue({
      entityId: 'owner::acme', preferences: [], behaviors: [], facts: [], summary: null, memoryCount: 2, lastInteraction: '2026-09-12T00:00:00Z',
    })
    const result = await ensureCompanyProfile('owner::acme')
    expect(h.reflectOnEntity).not.toHaveBeenCalled()
    // memoryCount > 0 even with no summary yet — still real, honest info worth showing.
    expect(result?.memoryCount).toBe(2)
    expect(result?.summary).toBeNull()
  })

  it('reflects once the 3-memory floor is met with no prior reflection, and returns the freshly-read-back profile', async () => {
    h.getEntityProfile
      .mockResolvedValueOnce({ entityId: 'owner::acme', preferences: [], behaviors: [], facts: [], summary: null, memoryCount: 5, lastInteraction: null })
      .mockResolvedValueOnce({
        entityId: 'owner::acme',
        preferences: ['likes blue'],
        behaviors: ['prefers async code'],
        facts: ['building Ledgerly'],
        summary: 'A founder building Ledgerly who likes blue and async code.',
        memoryCount: 5,
        lastInteraction: '2026-09-12T23:40:02Z',
      })
    h.reflectOnEntity.mockResolvedValue({ entityId: 'owner::acme', insights: [{ x: 1 }], memoriesReviewed: 5 })

    const result = await ensureCompanyProfile('owner::acme')

    expect(h.reflectOnEntity).toHaveBeenCalledWith('owner::acme')
    expect(h.getEntityProfile).toHaveBeenCalledTimes(2)
    expect(result?.summary).toBe('A founder building Ledgerly who likes blue and async code.')
    expect(result?.facts).toEqual(['building Ledgerly'])
  })

  it('does NOT re-reflect when a profile already exists and too few new memories have accumulated since', async () => {
    h.getEntityProfile.mockResolvedValue({
      entityId: 'owner::acme',
      preferences: ['likes blue'],
      behaviors: [],
      facts: [],
      summary: 'Existing summary.',
      memoryCount: 5, // same as last reflected count -> 0 new memories
      lastInteraction: null,
    })
    const result = await ensureCompanyProfile('owner::acme')
    expect(h.reflectOnEntity).not.toHaveBeenCalled()
    expect(result?.summary).toBe('Existing summary.')
  })

  it('when reflectOnEntity finds too few memories (a race/edge case), falls back to the existing profile rather than showing nothing', async () => {
    h.getEntityProfile.mockResolvedValueOnce({
      entityId: 'owner::acme', preferences: [], behaviors: [], facts: [], summary: 'Old summary.', memoryCount: 3, lastInteraction: null,
    })
    h.reflectOnEntity.mockResolvedValue({ entityId: 'owner::acme', insights: [], memoriesReviewed: 1, message: 'Not enough memories to reflect (need 3+)' })

    const result = await ensureCompanyProfile('owner::acme')
    expect(result?.summary).toBe('Old summary.')
  })

  it('when reflectOnEntity itself fails (null), falls back to the existing profile', async () => {
    h.getEntityProfile.mockResolvedValueOnce({
      entityId: 'owner::acme', preferences: [], behaviors: [], facts: [], summary: null, memoryCount: 5, lastInteraction: null,
    })
    h.reflectOnEntity.mockResolvedValue(null)

    const result = await ensureCompanyProfile('owner::acme')
    // No summary existed, but memoryCount > 0 is still real info.
    expect(result?.memoryCount).toBe(5)
  })

  it('returns null when getEntityProfile itself fails outright', async () => {
    h.getEntityProfile.mockResolvedValue(null)
    const result = await ensureCompanyProfile('owner::acme')
    expect(result).toBeNull()
  })

  it('never throws even if a dependency throws unexpectedly', async () => {
    h.getEntityProfile.mockRejectedValue(new Error('network down'))
    await expect(ensureCompanyProfile('owner::acme')).resolves.toBeNull()
  })
})
