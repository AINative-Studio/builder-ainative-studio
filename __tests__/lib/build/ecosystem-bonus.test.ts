import { describe, it, expect } from 'vitest'
import {
  ECOSYSTEM_BONUS_BUILDS,
  ECOSYSTEM_BONUS_MIN_PRIMITIVES,
  ECOSYSTEM_BONUS_MAX_TOTAL,
  DEFAULT_SUBSTRATE_PRIMITIVES,
  defaultSubstratePrimitives,
  countEcosystemPrimitives,
  computeEcosystemBonus,
  computeTotalEcosystemBonus,
  ecosystemBonusMessage,
} from '@/lib/build/ecosystem-bonus'

describe('ecosystem-bonus (#324 GR-15)', () => {
  describe('DEFAULT_SUBSTRATE_PRIMITIVES', () => {
    it('always contains zerodb (the spec default) plus the foundational substrate', () => {
      expect(DEFAULT_SUBSTRATE_PRIMITIVES.has('zerodb')).toBe(true)
      // Foundational substrate from the catalog — wired into EVERY build, so it
      // must never count toward the bonus (or the bonus would be universal).
      for (const name of ['instant db', 'zeromemory', 'ai kit', 'agent cloud']) {
        expect(DEFAULT_SUBSTRATE_PRIMITIVES.has(name)).toBe(true)
      }
    })
  })

  describe('countEcosystemPrimitives', () => {
    it('counts distinct non-substrate primitives', () => {
      expect(countEcosystemPrimitives(['ZeroInvoice', 'ZeroPipeline'])).toBe(2)
    })

    it('excludes ZeroDB and the foundational substrate (case-insensitive)', () => {
      expect(
        countEcosystemPrimitives(['ZeroDB', 'zerodb', 'AI Kit', 'Instant DB', 'ZeroMemory', 'Agent Cloud']),
      ).toBe(0)
    })

    it('dedupes repeated names (normalized)', () => {
      expect(countEcosystemPrimitives(['ZeroInvoice', 'zeroinvoice', ' ZeroInvoice '])).toBe(1)
    })

    it('tolerates empty, missing, and malformed input', () => {
      expect(countEcosystemPrimitives([])).toBe(0)
      expect(countEcosystemPrimitives(undefined as unknown as string[])).toBe(0)
      expect(countEcosystemPrimitives(['', '   ', 42 as unknown as string, null as unknown as string])).toBe(0)
    })
  })

  describe('computeEcosystemBonus', () => {
    it(`grants ${ECOSYSTEM_BONUS_BUILDS} when >= ${ECOSYSTEM_BONUS_MIN_PRIMITIVES} ecosystem primitives are composed`, () => {
      expect(computeEcosystemBonus(['ZeroInvoice', 'ZeroPipeline'])).toBe(ECOSYSTEM_BONUS_BUILDS)
      expect(computeEcosystemBonus(['ZeroInvoice', 'ZeroPipeline', 'ZeroCommerce'])).toBe(ECOSYSTEM_BONUS_BUILDS)
    })

    it('grants 0 below the threshold', () => {
      expect(computeEcosystemBonus([])).toBe(0)
      expect(computeEcosystemBonus(['ZeroInvoice'])).toBe(0)
    })

    it('substrate-only compositions never qualify (ZeroDB is the default, not a bonus)', () => {
      expect(computeEcosystemBonus(['ZeroDB', 'AI Kit', 'Instant DB', 'ZeroMemory', 'Agent Cloud'])).toBe(0)
    })

    it('substrate + a single ecosystem primitive still does not qualify', () => {
      expect(computeEcosystemBonus(['ZeroDB', 'AI Kit', 'ZeroInvoice'])).toBe(0)
    })

    it('is deterministic — same input, same output', () => {
      const input = ['ZeroDB', 'ZeroInvoice', 'ZeroPipeline']
      expect(computeEcosystemBonus([...input])).toBe(computeEcosystemBonus([...input]))
    })
  })

  describe('computeTotalEcosystemBonus', () => {
    const qualifying = ['ZeroInvoice', 'ZeroPipeline']

    it('sums the per-build bonuses', () => {
      expect(computeTotalEcosystemBonus([qualifying])).toBe(ECOSYSTEM_BONUS_BUILDS)
      expect(computeTotalEcosystemBonus([qualifying, ['ZeroDB'], qualifying])).toBe(2 * ECOSYSTEM_BONUS_BUILDS)
    })

    it(`caps the total at ${ECOSYSTEM_BONUS_MAX_TOTAL} so free runway stays finite`, () => {
      const many = Array.from({ length: 10 }, () => qualifying)
      expect(computeTotalEcosystemBonus(many)).toBe(ECOSYSTEM_BONUS_MAX_TOTAL)
    })

    it('returns 0 for no builds or malformed input', () => {
      expect(computeTotalEcosystemBonus([])).toBe(0)
      expect(computeTotalEcosystemBonus(undefined as unknown as string[][])).toBe(0)
    })
  })

  describe('OpenCapStack track-scoped substrate (#427/#443 follow-up)', () => {
    it('counts as substrate on the company track (real, unconditional provisioning per #427)', () => {
      expect(defaultSubstratePrimitives('company').has('opencapstack')).toBe(true)
      expect(countEcosystemPrimitives(['ZeroInvoice', 'OpenCapStack'], 'company')).toBe(1)
    })

    it('does NOT count as substrate on the app track (not auto-provisioned there)', () => {
      expect(defaultSubstratePrimitives('app').has('opencapstack')).toBe(false)
      expect(countEcosystemPrimitives(['ZeroInvoice', 'OpenCapStack'], 'app')).toBe(2)
    })

    it('a nonprofit idea keeps OpenCapStack out of substrate, so composing it still counts (#302 carve-out)', () => {
      const nonprofitIdea = 'a nonprofit donation platform to manage donors, grants, and impact reporting'
      expect(defaultSubstratePrimitives('company', nonprofitIdea).has('opencapstack')).toBe(false)
      expect(countEcosystemPrimitives(['AINativeNGO', 'OpenCapStack'], 'company', nonprofitIdea)).toBe(2)
    })

    it('DEFAULT_SUBSTRATE_PRIMITIVES (no-idea default) still includes opencapstack on the company track', () => {
      expect(DEFAULT_SUBSTRATE_PRIMITIVES.has('opencapstack')).toBe(true)
    })
  })

  describe('ecosystemBonusMessage', () => {
    it('is Cody, first person, no exclamation, singular build', () => {
      const m = ecosystemBonusMessage(3, 1)
      expect(m).toBe('You composed 3 AINative primitives — I extended your free runway by 1 build.')
      expect(m).not.toContain('!')
    })

    it('pluralizes builds', () => {
      expect(ecosystemBonusMessage(4, 2)).toBe(
        'You composed 4 AINative primitives — I extended your free runway by 2 builds.',
      )
    })
  })
})
