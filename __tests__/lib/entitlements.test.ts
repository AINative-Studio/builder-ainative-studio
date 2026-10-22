import { describe, it, expect } from 'vitest'
import { entitlementsByUserType, anonymousEntitlements } from '@/lib/entitlements'

describe('entitlementsByUserType', () => {
  it('has all three expected tier keys', () => {
    expect(Object.keys(entitlementsByUserType).sort()).toEqual(['ainative', 'guest', 'regular'])
  })

  it('guest tier has the expected real values', () => {
    expect(entitlementsByUserType.guest).toEqual({
      maxMessagesPerDay: 20,
      maxTokensPerRequest: 8000,
      canUseExtendedThinking: false,
      canSelectModel: true,
    })
  })

  it('regular tier has the expected real values', () => {
    expect(entitlementsByUserType.regular).toEqual({
      maxMessagesPerDay: 50,
      maxTokensPerRequest: 16000,
      canUseExtendedThinking: true,
      canSelectModel: true,
    })
  })

  it('ainative tier has the expected real values', () => {
    expect(entitlementsByUserType.ainative).toEqual({
      maxMessagesPerDay: 200,
      maxTokensPerRequest: 32000,
      canUseExtendedThinking: true,
      canSelectModel: true,
    })
  })

  it('every entry has exactly the four expected fields with correct types', () => {
    for (const key of ['guest', 'regular', 'ainative'] as const) {
      const entry = entitlementsByUserType[key]
      expect(Object.keys(entry).sort()).toEqual(
        ['canSelectModel', 'canUseExtendedThinking', 'maxMessagesPerDay', 'maxTokensPerRequest'].sort(),
      )
      expect(typeof entry.maxMessagesPerDay).toBe('number')
      expect(typeof entry.maxTokensPerRequest).toBe('number')
      expect(typeof entry.canUseExtendedThinking).toBe('boolean')
      expect(typeof entry.canSelectModel).toBe('boolean')
    }
  })

  it('ainative tier has strictly the highest limits of the three named tiers', () => {
    const { ainative, guest, regular } = entitlementsByUserType
    expect(ainative.maxMessagesPerDay).toBeGreaterThan(guest.maxMessagesPerDay)
    expect(ainative.maxMessagesPerDay).toBeGreaterThan(regular.maxMessagesPerDay)
    expect(ainative.maxTokensPerRequest).toBeGreaterThan(guest.maxTokensPerRequest)
    expect(ainative.maxTokensPerRequest).toBeGreaterThan(regular.maxTokensPerRequest)
  })
})

describe('anonymousEntitlements', () => {
  it('has the expected real values', () => {
    expect(anonymousEntitlements).toEqual({
      maxMessagesPerDay: 10,
      maxTokensPerRequest: 4000,
      canUseExtendedThinking: false,
      canSelectModel: false,
    })
  })

  it('is the most restrictive of all four entries (guest, regular, ainative, anonymous)', () => {
    const all = [
      entitlementsByUserType.guest,
      entitlementsByUserType.regular,
      entitlementsByUserType.ainative,
      anonymousEntitlements,
    ]
    for (const entry of all) {
      if (entry === anonymousEntitlements) continue
      expect(anonymousEntitlements.maxMessagesPerDay).toBeLessThanOrEqual(entry.maxMessagesPerDay)
      expect(anonymousEntitlements.maxTokensPerRequest).toBeLessThanOrEqual(entry.maxTokensPerRequest)
    }
    // Strictly least on both numeric axes vs every other tier
    expect(anonymousEntitlements.maxMessagesPerDay).toBeLessThan(entitlementsByUserType.guest.maxMessagesPerDay)
    expect(anonymousEntitlements.maxTokensPerRequest).toBeLessThan(entitlementsByUserType.guest.maxTokensPerRequest)
    expect(anonymousEntitlements.canUseExtendedThinking).toBe(false)
    expect(anonymousEntitlements.canSelectModel).toBe(false)
  })
})
