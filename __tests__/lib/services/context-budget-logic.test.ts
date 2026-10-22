import { describe, it, expect } from 'vitest'
import {
  mapTypeToCategory,
  calculateBudgetState,
  canLoad,
  calculatePriorityScore,
  calculateAllocations,
  findUnloadCandidates,
  generateOptimizationSuggestions,
  WARNING_THRESHOLD_PCT,
  CRITICAL_THRESHOLD_PCT,
  type BudgetItemInput,
} from '@/lib/services/context-budget-logic'

/**
 * Issue #1201 — Coverage Phase 1 follow-up.
 *
 * lib/services/context-budget-logic.ts (GitHub Issue #20) is explicitly
 * documented as the pure, DB-agnostic core of the Context Budget Manager —
 * extracted specifically so it would be "fully unit-testable without a
 * database." It had zero test coverage despite that design intent. This
 * covers budget-state math, priority scoring, per-category allocation,
 * unload-candidate selection, and optimization-suggestion generation.
 */

function item(overrides: Partial<BudgetItemInput> = {}): BudgetItemInput {
  return {
    id: 'item-1',
    type: 'file',
    name: 'test item',
    tokenCost: 100,
    priority: 'medium',
    ...overrides,
  }
}

describe('#1201 lib/services/context-budget-logic', () => {
  describe('mapTypeToCategory', () => {
    it.each([
      ['skill', 'skills'],
      ['file', 'files'],
      ['message', 'history'],
      ['history', 'history'],
      ['tool', 'tools'],
      ['baseline', 'baseline'],
    ])('maps %s to %s', (type, expected) => {
      expect(mapTypeToCategory(type)).toBe(expected)
    })

    it('falls back to "other" for an unrecognized type', () => {
      expect(mapTypeToCategory('bogus')).toBe('other')
    })
  })

  describe('calculateBudgetState', () => {
    it('computes used/remaining/percentage for a normal in-range value', () => {
      const state = calculateBudgetState(1000, 400)
      expect(state).toEqual({
        total: 1000,
        used: 400,
        remaining: 600,
        usagePercentage: 40,
        isWarning: false,
        isCritical: false,
      })
    })

    it('flags isWarning at or above the warning threshold but below critical', () => {
      const state = calculateBudgetState(1000, WARNING_THRESHOLD_PCT * 10)
      expect(state.isWarning).toBe(true)
      expect(state.isCritical).toBe(false)
    })

    it('flags isCritical at or above the critical threshold', () => {
      const state = calculateBudgetState(1000, CRITICAL_THRESHOLD_PCT * 10)
      expect(state.isCritical).toBe(true)
      expect(state.isWarning).toBe(true)
    })

    it('clamps a negative total to zero', () => {
      const state = calculateBudgetState(-100, 50)
      expect(state.total).toBe(0)
      expect(state.used).toBe(0)
      expect(state.usagePercentage).toBe(0)
    })

    it('clamps used below zero up to zero', () => {
      const state = calculateBudgetState(1000, -50)
      expect(state.used).toBe(0)
      expect(state.remaining).toBe(1000)
    })

    it('clamps used above total down to total, leaving zero remaining', () => {
      const state = calculateBudgetState(1000, 5000)
      expect(state.used).toBe(1000)
      expect(state.remaining).toBe(0)
      expect(state.usagePercentage).toBe(100)
    })

    it('returns 0% usage when total is zero, without dividing by zero', () => {
      const state = calculateBudgetState(0, 0)
      expect(state.usagePercentage).toBe(0)
      expect(state.isWarning).toBe(false)
    })
  })

  describe('canLoad', () => {
    it('allows loading when tokenCost is less than or equal to remaining', () => {
      expect(canLoad(100, 200)).toBe(true)
      expect(canLoad(200, 200)).toBe(true)
    })

    it('disallows loading when tokenCost exceeds remaining', () => {
      expect(canLoad(201, 200)).toBe(false)
    })
  })

  describe('calculatePriorityScore', () => {
    it('scores a critical-priority baseline item highest under no budget pressure', () => {
      const score = calculatePriorityScore(
        { type: 'baseline', priority: 'critical', tokenCost: 100 },
        { isWarning: false, isCritical: false }
      )
      expect(score).toBe(100 + 20) // PRIORITY_SCORES.critical + TYPE_LOAD_BONUS.baseline
    })

    it('halves the score under critical budget pressure', () => {
      const score = calculatePriorityScore(
        { type: 'history', priority: 'high', tokenCost: 100 },
        { isWarning: false, isCritical: true }
      )
      expect(score).toBe(75 * 0.5 + 1) // halved + TYPE_LOAD_BONUS.history
    })

    it('applies a 0.75 multiplier under warning (non-critical) pressure', () => {
      const score = calculatePriorityScore(
        { type: 'tool', priority: 'medium', tokenCost: 100 },
        { isWarning: true, isCritical: false }
      )
      expect(score).toBe(50 * 0.75 + 10)
    })

    it('treats an unrecognized priority as a base score of 0', () => {
      const score = calculatePriorityScore(
        { type: 'file', priority: 'bogus' as never, tokenCost: 100 },
        { isWarning: false, isCritical: false }
      )
      expect(score).toBe(0 + 5) // just the file type bonus
    })

    it('applies a -10 penalty for very expensive items (tokenCost > 5000)', () => {
      const cheap = calculatePriorityScore(
        { type: 'message', priority: 'low', tokenCost: 100 },
        { isWarning: false, isCritical: false }
      )
      const expensive = calculatePriorityScore(
        { type: 'message', priority: 'low', tokenCost: 5001 },
        { isWarning: false, isCritical: false }
      )
      expect(expensive).toBe(cheap - 10)
    })
  })

  describe('calculateAllocations', () => {
    it('always includes all six categories, zeroed when empty', () => {
      const allocations = calculateAllocations([], 1000)
      const categories = allocations.map((a) => a.category)
      expect(categories).toEqual(['baseline', 'skills', 'files', 'history', 'tools', 'other'])
      expect(allocations.every((a) => a.tokens === 0 && a.itemCount === 0)).toBe(true)
    })

    it('aggregates token totals and counts per mapped category', () => {
      const items: BudgetItemInput[] = [
        item({ type: 'file', tokenCost: 100 }),
        item({ type: 'file', tokenCost: 50 }),
        item({ type: 'skill', tokenCost: 200 }),
      ]
      const allocations = calculateAllocations(items, 1000)
      const files = allocations.find((a) => a.category === 'files')!
      const skills = allocations.find((a) => a.category === 'skills')!

      expect(files.tokens).toBe(150)
      expect(files.itemCount).toBe(2)
      expect(skills.tokens).toBe(200)
      expect(skills.itemCount).toBe(1)
    })

    it('computes percentage relative to totalBudget, 0% when totalBudget is 0', () => {
      const items = [item({ type: 'file', tokenCost: 250 })]
      const withBudget = calculateAllocations(items, 1000)
      expect(withBudget.find((a) => a.category === 'files')!.percentage).toBe(25)

      const noBudget = calculateAllocations(items, 0)
      expect(noBudget.find((a) => a.category === 'files')!.percentage).toBe(0)
    })

    it('flags isOverBudget once a category exceeds its DEFAULT_CATEGORY_MAX_PCT', () => {
      // files max is 25%; push it to 50%
      const items = [item({ type: 'file', tokenCost: 500 })]
      const allocations = calculateAllocations(items, 1000)
      expect(allocations.find((a) => a.category === 'files')!.isOverBudget).toBe(true)
      expect(allocations.find((a) => a.category === 'skills')!.isOverBudget).toBe(false)
    })

    it('tolerates a missing tokenCost by treating it as 0', () => {
      const items = [{ ...item({ type: 'file' }), tokenCost: undefined as unknown as number }]
      const allocations = calculateAllocations(items, 1000)
      expect(allocations.find((a) => a.category === 'files')!.tokens).toBe(0)
    })
  })

  describe('findUnloadCandidates', () => {
    const baseOptions: {
      eligiblePriorities: Array<'low' | 'medium' | 'high'>
      minAccessCount: number
      minTimeSinceAccess: number
    } = {
      eligiblePriorities: ['low', 'medium', 'high'],
      minAccessCount: 0,
      minTimeSinceAccess: 0,
    }

    it('never selects a critical-priority item regardless of eligibility', () => {
      const items = [item({ id: 'c1', priority: 'critical', tokenCost: 1000 })]
      const result = findUnloadCandidates(items, 500, {
        ...baseOptions,
        eligiblePriorities: ['critical' as never, 'low', 'medium', 'high'],
      })
      expect(result).toEqual([])
    })

    it('orders candidates by lowest priority first', () => {
      const items = [
        item({ id: 'high', priority: 'high', tokenCost: 10 }),
        item({ id: 'low', priority: 'low', tokenCost: 10 }),
        item({ id: 'medium', priority: 'medium', tokenCost: 10 }),
      ]
      const result = findUnloadCandidates(items, 10000, baseOptions)
      expect(result.map((i) => i.id)).toEqual(['low', 'medium', 'high'])
    })

    it('breaks priority ties by oldest lastAccessedAt first', () => {
      const items = [
        item({ id: 'newer', priority: 'low', tokenCost: 10, lastAccessedAt: new Date('2026-01-02') }),
        item({ id: 'older', priority: 'low', tokenCost: 10, lastAccessedAt: new Date('2026-01-01') }),
      ]
      const result = findUnloadCandidates(items, 10000, baseOptions)
      expect(result.map((i) => i.id)).toEqual(['older', 'newer'])
    })

    it('excludes items whose priority is not in eligiblePriorities', () => {
      const items = [item({ id: 'x', priority: 'high', tokenCost: 10 })]
      const result = findUnloadCandidates(items, 10000, {
        ...baseOptions,
        eligiblePriorities: ['low'],
      })
      expect(result).toEqual([])
    })

    it('excludes items below minAccessCount', () => {
      const items = [item({ id: 'x', priority: 'low', tokenCost: 10, accessCount: 2 })]
      const result = findUnloadCandidates(items, 10000, { ...baseOptions, minAccessCount: 5 })
      expect(result).toEqual([])
    })

    it('excludes items accessed more recently than minTimeSinceAccess', () => {
      const now = Date.now()
      const items = [
        item({ id: 'recent', priority: 'low', tokenCost: 10, lastAccessedAt: new Date(now - 1000) }),
      ]
      const result = findUnloadCandidates(items, 10000, {
        ...baseOptions,
        minTimeSinceAccess: 60000,
        now,
      })
      expect(result).toEqual([])
    })

    it('treats an item with no lastAccessedAt as infinitely stale (always eligible on recency)', () => {
      const items = [item({ id: 'never-accessed', priority: 'low', tokenCost: 10 })]
      const result = findUnloadCandidates(items, 10000, {
        ...baseOptions,
        minTimeSinceAccess: 999999999,
      })
      expect(result.map((i) => i.id)).toEqual(['never-accessed'])
    })

    it('stops once enough tokens have been freed, not selecting every eligible item', () => {
      const items = [
        item({ id: 'a', priority: 'low', tokenCost: 300 }),
        item({ id: 'b', priority: 'low', tokenCost: 300 }),
        item({ id: 'c', priority: 'low', tokenCost: 300 }),
      ]
      const result = findUnloadCandidates(items, 400, baseOptions)
      expect(result.length).toBe(2) // 300 + 300 = 600 >= 400, stop after 2nd
    })

    it('returns fewer items than requested tokens when not enough eligible items exist', () => {
      const items = [item({ id: 'only', priority: 'low', tokenCost: 50 })]
      const result = findUnloadCandidates(items, 10000, baseOptions)
      expect(result.map((i) => i.id)).toEqual(['only'])
    })
  })

  describe('generateOptimizationSuggestions', () => {
    it('suggests unloading rarely-accessed non-critical items', () => {
      const items = [item({ accessCount: 0, priority: 'low' })]
      const suggestions = generateOptimizationSuggestions(items)
      const unload = suggestions.find((s) => s.type === 'unload')
      expect(unload).toBeDefined()
      expect(unload!.affectedItems).toHaveLength(1)
      expect(unload!.autoApplicable).toBe(false) // default aggressiveness is 'moderate'
    })

    it('never includes critical-priority items in the unload suggestion', () => {
      const items = [item({ accessCount: 0, priority: 'critical' })]
      const suggestions = generateOptimizationSuggestions(items)
      expect(suggestions.find((s) => s.type === 'unload')).toBeUndefined()
    })

    it('marks the unload suggestion autoApplicable only when aggressiveness is "aggressive"', () => {
      const items = [item({ accessCount: 0, priority: 'low' })]
      const suggestions = generateOptimizationSuggestions(items, { aggressiveness: 'aggressive' })
      expect(suggestions.find((s) => s.type === 'unload')!.autoApplicable).toBe(true)
    })

    it('raises the low-access threshold as aggressiveness increases', () => {
      const items = [item({ accessCount: 2, priority: 'low' })]
      const conservative = generateOptimizationSuggestions(items, { aggressiveness: 'conservative' })
      expect(conservative.find((s) => s.type === 'unload')).toBeUndefined()

      const aggressive = generateOptimizationSuggestions(items, { aggressiveness: 'aggressive' })
      expect(aggressive.find((s) => s.type === 'unload')).toBeDefined()
    })

    it('suggests compressing large, not-yet-compressed files above the threshold', () => {
      const items = [
        item({ type: 'file', tokenCost: 3000, accessCount: 10, priority: 'high' }),
      ]
      const suggestions = generateOptimizationSuggestions(items, { compressionThreshold: 2000 })
      const compress = suggestions.find((s) => s.type === 'compress')
      expect(compress).toBeDefined()
      expect(compress!.estimatedSavings).toBe(Math.round(3000 * 0.6))
    })

    it('excludes already-compressed files and respects compressionEnabled:false', () => {
      const items = [
        item({
          type: 'file',
          tokenCost: 3000,
          accessCount: 10,
          priority: 'high',
          metadata: { compressed: true },
        }),
      ]
      expect(generateOptimizationSuggestions(items).find((s) => s.type === 'compress')).toBeUndefined()

      const uncompressed = [item({ type: 'file', tokenCost: 3000, accessCount: 10, priority: 'high' })]
      expect(
        generateOptimizationSuggestions(uncompressed, { compressionEnabled: false }).find(
          (s) => s.type === 'compress'
        )
      ).toBeUndefined()
    })

    it('suggests summarizing old messages when more than 2 exist past the 10-minute window', () => {
      const now = Date.now()
      const old = new Date(now - 700000) // > 600000ms
      const items = [
        item({ type: 'message', lastAccessedAt: old, accessCount: 10, priority: 'medium' }),
        item({ type: 'message', lastAccessedAt: old, accessCount: 10, priority: 'medium' }),
        item({ type: 'message', lastAccessedAt: old, accessCount: 10, priority: 'medium' }),
      ]
      const suggestions = generateOptimizationSuggestions(items, { now })
      expect(suggestions.find((s) => s.type === 'summarize')).toBeDefined()
    })

    it('does not suggest summarizing when 2 or fewer old messages qualify', () => {
      const now = Date.now()
      const old = new Date(now - 700000)
      const items = [
        item({ type: 'message', lastAccessedAt: old, accessCount: 10, priority: 'medium' }),
        item({ type: 'message', lastAccessedAt: old, accessCount: 10, priority: 'medium' }),
      ]
      const suggestions = generateOptimizationSuggestions(items, { now })
      expect(suggestions.find((s) => s.type === 'summarize')).toBeUndefined()
    })

    it('suggests consolidating when more than 3 skills share the same metadata.summary category', () => {
      const items = Array.from({ length: 4 }, (_, i) =>
        item({ id: `skill-${i}`, type: 'skill', priority: 'medium', metadata: { summary: 'testing' } })
      )
      const suggestions = generateOptimizationSuggestions(items)
      const consolidate = suggestions.find((s) => s.type === 'consolidate')
      expect(consolidate).toBeDefined()
      expect(consolidate!.affectedItems).toHaveLength(4)
    })

    it('buckets skills with no metadata.summary under "general"', () => {
      const items = Array.from({ length: 4 }, (_, i) =>
        item({ id: `skill-${i}`, type: 'skill', priority: 'medium' })
      )
      const suggestions = generateOptimizationSuggestions(items)
      expect(suggestions.find((s) => s.type === 'consolidate' && s.description.includes('general'))).toBeDefined()
    })

    it('does not suggest consolidating when 3 or fewer skills share a category', () => {
      const items = Array.from({ length: 3 }, (_, i) =>
        item({ id: `skill-${i}`, type: 'skill', priority: 'medium', metadata: { summary: 'testing' } })
      )
      const suggestions = generateOptimizationSuggestions(items)
      expect(suggestions.find((s) => s.type === 'consolidate')).toBeUndefined()
    })

    it('sorts the final suggestions by priority: high, then medium, then low', () => {
      const now = Date.now()
      const old = new Date(now - 700000)
      const items = [
        // consolidate (low) — 4 skills same category
        ...Array.from({ length: 4 }, (_, i) =>
          item({ id: `skill-${i}`, type: 'skill', priority: 'medium', metadata: { summary: 'x' }, accessCount: 10 })
        ),
        // compress (medium)
        item({ id: 'bigfile', type: 'file', tokenCost: 3000, accessCount: 10, priority: 'high' }),
        // unload (high) — 0 access count, non-critical
        item({ id: 'rarely-used', accessCount: 0, priority: 'low' }),
      ]
      const suggestions = generateOptimizationSuggestions(items, { now })
      const types = suggestions.map((s) => s.type)
      const priorityRank = { high: 0, medium: 1, low: 2 } as const
      const priorities = suggestions.map((s) => priorityRank[s.priority])
      expect(priorities).toEqual([...priorities].sort((a, b) => a - b))
      expect(types).toContain('unload')
      expect(types).toContain('compress')
      expect(types).toContain('consolidate')
    })

    it('returns an empty array for an empty item list', () => {
      expect(generateOptimizationSuggestions([])).toEqual([])
    })
  })
})
