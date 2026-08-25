import { describe, it, expect } from 'vitest'
import {
  BEDROCK_MODEL_BY_TIER,
  AINATIVE_MODEL_BY_TIER,
  MODEL_LABEL_BY_TIER,
  coerceTier,
  modelsForTier,
  type Tier,
} from '@/lib/build/tier-models'

/**
 * lib/build/tier-models — pure model-tiering logic (#207).
 * No I/O, no mocks needed. Covers coerceTier + modelsForTier
 * across all tier strings and invalid/edge-case inputs.
 */

const VALID_TIERS: Tier[] = ['hobbyist', 'pro', 'scale', 'enterprise']

describe('tier constants', () => {
  it('BEDROCK_MODEL_BY_TIER has all four tiers with non-empty model ids', () => {
    for (const tier of VALID_TIERS) {
      expect(typeof BEDROCK_MODEL_BY_TIER[tier]).toBe('string')
      expect(BEDROCK_MODEL_BY_TIER[tier].length).toBeGreaterThan(0)
    }
  })

  it('AINATIVE_MODEL_BY_TIER has all four tiers with non-empty model names', () => {
    for (const tier of VALID_TIERS) {
      expect(typeof AINATIVE_MODEL_BY_TIER[tier]).toBe('string')
      expect(AINATIVE_MODEL_BY_TIER[tier].length).toBeGreaterThan(0)
    }
  })

  it('MODEL_LABEL_BY_TIER has all four tiers with human-readable labels', () => {
    for (const tier of VALID_TIERS) {
      expect(typeof MODEL_LABEL_BY_TIER[tier]).toBe('string')
      expect(MODEL_LABEL_BY_TIER[tier]).toContain('Claude')
    }
  })

  it('hobbyist maps to Haiku, pro/scale to Sonnet, enterprise to Opus', () => {
    expect(BEDROCK_MODEL_BY_TIER.hobbyist).toContain('haiku')
    expect(BEDROCK_MODEL_BY_TIER.pro).toContain('sonnet')
    expect(BEDROCK_MODEL_BY_TIER.scale).toContain('sonnet')
    expect(BEDROCK_MODEL_BY_TIER.enterprise).toContain('opus')
  })

  it('pro and scale share the same bedrock model (mid-tier Sonnet)', () => {
    expect(BEDROCK_MODEL_BY_TIER.pro).toBe(BEDROCK_MODEL_BY_TIER.scale)
    expect(AINATIVE_MODEL_BY_TIER.pro).toBe(AINATIVE_MODEL_BY_TIER.scale)
  })
})

describe('coerceTier', () => {
  it('passes through the four valid tiers unchanged', () => {
    for (const tier of VALID_TIERS) {
      expect(coerceTier(tier)).toBe(tier)
    }
  })

  it('normalizes uppercase input', () => {
    expect(coerceTier('HOBBYIST')).toBe('hobbyist')
    expect(coerceTier('PRO')).toBe('pro')
    expect(coerceTier('SCALE')).toBe('scale')
    expect(coerceTier('ENTERPRISE')).toBe('enterprise')
  })

  it('normalizes mixed-case input', () => {
    expect(coerceTier('Hobbyist')).toBe('hobbyist')
    expect(coerceTier('Pro')).toBe('pro')
    expect(coerceTier('Enterprise')).toBe('enterprise')
  })

  it('falls back to hobbyist for unknown string values', () => {
    expect(coerceTier('free')).toBe('hobbyist')
    expect(coerceTier('startup')).toBe('hobbyist')
    expect(coerceTier('growth')).toBe('hobbyist')
    expect(coerceTier('unknown-tier')).toBe('hobbyist')
  })

  it('falls back to hobbyist for null', () => {
    expect(coerceTier(null)).toBe('hobbyist')
  })

  it('falls back to hobbyist for undefined', () => {
    expect(coerceTier(undefined)).toBe('hobbyist')
  })

  it('falls back to hobbyist for empty string', () => {
    expect(coerceTier('')).toBe('hobbyist')
  })
})

describe('modelsForTier', () => {
  it('returns a TierModels object with all four fields for a valid tier', () => {
    const result = modelsForTier('pro')
    expect(result.tier).toBe('pro')
    expect(typeof result.bedrockModel).toBe('string')
    expect(typeof result.ainativeModel).toBe('string')
    expect(typeof result.label).toBe('string')
    expect(result.bedrockModel.length).toBeGreaterThan(0)
  })

  it('returns hobbyist models for null input', () => {
    const result = modelsForTier(null)
    expect(result.tier).toBe('hobbyist')
    expect(result.bedrockModel).toBe(BEDROCK_MODEL_BY_TIER.hobbyist)
    expect(result.ainativeModel).toBe(AINATIVE_MODEL_BY_TIER.hobbyist)
    expect(result.label).toBe(MODEL_LABEL_BY_TIER.hobbyist)
  })

  it('returns hobbyist models for undefined input', () => {
    const result = modelsForTier(undefined)
    expect(result.tier).toBe('hobbyist')
  })

  it('returns hobbyist models for an unknown tier string', () => {
    const result = modelsForTier('free-forever')
    expect(result.tier).toBe('hobbyist')
    expect(result.bedrockModel).toBe(BEDROCK_MODEL_BY_TIER.hobbyist)
  })

  it('returns correct models for each tier', () => {
    for (const tier of VALID_TIERS) {
      const result = modelsForTier(tier)
      expect(result.tier).toBe(tier)
      expect(result.bedrockModel).toBe(BEDROCK_MODEL_BY_TIER[tier])
      expect(result.ainativeModel).toBe(AINATIVE_MODEL_BY_TIER[tier])
      expect(result.label).toBe(MODEL_LABEL_BY_TIER[tier])
    }
  })

  it('is consistent with coerceTier — tier field always matches coerceTier output', () => {
    const inputs = ['hobbyist', 'PRO', 'Scale', null, undefined, 'bogus']
    for (const input of inputs) {
      const result = modelsForTier(input as string | null | undefined)
      expect(result.tier).toBe(coerceTier(input as string | null | undefined))
    }
  })
})
