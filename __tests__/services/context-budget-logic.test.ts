/**
 * Context Budget Manager - Pure Logic Tests
 *
 * Exercises the deterministic, DB-agnostic budgeting logic that powers the
 * Context Budget Manager (Issue #20). These map directly to the issue's Test
 * Plan: pre-load cost/availability, canLoad gating, optimization suggestions,
 * per-category breakdown, priority scoring, and unload-candidate selection.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateBudgetState,
  canLoad,
  calculatePriorityScore,
  calculateAllocations,
  mapTypeToCategory,
  findUnloadCandidates,
  generateOptimizationSuggestions,
  PRIORITY_SCORES,
  WARNING_THRESHOLD_PCT,
  CRITICAL_THRESHOLD_PCT,
  type BudgetItemInput,
} from '@/lib/services/context-budget-logic';

const NOW = 1_700_000_000_000; // fixed reference "now" for determinism

function item(overrides: Partial<BudgetItemInput>): BudgetItemInput {
  return {
    type: 'file',
    name: 'item',
    tokenCost: 1000,
    priority: 'medium',
    status: 'loaded',
    accessCount: 5,
    lastAccessedAt: new Date(NOW),
    ...overrides,
  };
}

describe('calculateBudgetState', () => {
  it('computes remaining and usage percentage', () => {
    const state = calculateBudgetState(128000, 5000);
    expect(state.remaining).toBe(123000);
    expect(state.usagePercentage).toBe(4);
    expect(state.isWarning).toBe(false);
    expect(state.isCritical).toBe(false);
  });

  it('flags warning at the 80% threshold', () => {
    const state = calculateBudgetState(100, WARNING_THRESHOLD_PCT);
    expect(state.isWarning).toBe(true);
    expect(state.isCritical).toBe(false);
  });

  it('flags critical at the 95% threshold', () => {
    const state = calculateBudgetState(100, CRITICAL_THRESHOLD_PCT);
    expect(state.isWarning).toBe(true);
    expect(state.isCritical).toBe(true);
  });

  it('clamps used tokens into [0, total] (never negative remaining)', () => {
    const over = calculateBudgetState(1000, 5000);
    expect(over.used).toBe(1000);
    expect(over.remaining).toBe(0);
    expect(over.usagePercentage).toBe(100);

    const under = calculateBudgetState(1000, -50);
    expect(under.used).toBe(0);
    expect(under.remaining).toBe(1000);
  });

  it('handles a zero total budget without dividing by zero', () => {
    const state = calculateBudgetState(0, 0);
    expect(state.usagePercentage).toBe(0);
    expect(state.remaining).toBe(0);
  });
});

describe('canLoad', () => {
  it('allows loading when cost fits remaining budget', () => {
    const { remaining } = calculateBudgetState(200000, 45000);
    expect(canLoad(2000, remaining)).toBe(true);
  });

  it('prevents loading when budget is insufficient', () => {
    // Test Plan: total 10000, used 9500 => remaining 500 < cost 2000
    const { remaining } = calculateBudgetState(10000, 9500);
    expect(canLoad(2000, remaining)).toBe(false);
    expect(remaining).toBeLessThan(2000);
  });

  it('treats an exact-fit item as loadable', () => {
    expect(canLoad(500, 500)).toBe(true);
  });
});

describe('mapTypeToCategory', () => {
  it('maps known types to their categories', () => {
    expect(mapTypeToCategory('skill')).toBe('skills');
    expect(mapTypeToCategory('file')).toBe('files');
    expect(mapTypeToCategory('message')).toBe('history');
    expect(mapTypeToCategory('history')).toBe('history');
    expect(mapTypeToCategory('tool')).toBe('tools');
    expect(mapTypeToCategory('baseline')).toBe('baseline');
  });

  it('falls back to "other" for unknown types', () => {
    expect(mapTypeToCategory('mystery')).toBe('other');
  });
});

describe('calculateAllocations', () => {
  it('tracks usage by category (Test Plan: breakdown.skills)', () => {
    const allocations = calculateAllocations(
      [item({ type: 'skill', tokenCost: 2000 })],
      128000
    );
    const skills = allocations.find((a) => a.category === 'skills')!;
    expect(skills.tokens).toBe(2000);
    expect(skills.itemCount).toBe(1);
  });

  it('always returns all six categories, zeroed when empty', () => {
    const allocations = calculateAllocations([], 128000);
    expect(allocations.map((a) => a.category).sort()).toEqual(
      ['baseline', 'files', 'history', 'other', 'skills', 'tools'].sort()
    );
    expect(allocations.every((a) => a.tokens === 0 && a.itemCount === 0)).toBe(true);
  });

  it('aggregates multiple items and computes percentage', () => {
    const allocations = calculateAllocations(
      [
        item({ type: 'file', tokenCost: 6000 }),
        item({ type: 'file', tokenCost: 4000 }),
      ],
      100000
    );
    const files = allocations.find((a) => a.category === 'files')!;
    expect(files.tokens).toBe(10000);
    expect(files.itemCount).toBe(2);
    expect(files.percentage).toBe(10);
  });

  it('flags a category as over budget when it exceeds its max percentage', () => {
    // baseline max is 20%; 30000 / 100000 = 30% > 20%
    const allocations = calculateAllocations(
      [item({ type: 'baseline', tokenCost: 30000 })],
      100000
    );
    const baseline = allocations.find((a) => a.category === 'baseline')!;
    expect(baseline.isOverBudget).toBe(true);
  });
});

describe('calculatePriorityScore', () => {
  it('uses base priority scores', () => {
    const base = { isWarning: false, isCritical: false };
    expect(
      calculatePriorityScore({ type: 'message', priority: 'critical', tokenCost: 100 }, base)
    ).toBe(PRIORITY_SCORES.critical + 3); // message bonus = 3
  });

  it('penalizes loading under budget pressure', () => {
    const normal = calculatePriorityScore(
      { type: 'skill', priority: 'high', tokenCost: 100 },
      { isWarning: false, isCritical: false }
    );
    const warning = calculatePriorityScore(
      { type: 'skill', priority: 'high', tokenCost: 100 },
      { isWarning: true, isCritical: false }
    );
    const critical = calculatePriorityScore(
      { type: 'skill', priority: 'high', tokenCost: 100 },
      { isWarning: false, isCritical: true }
    );
    expect(warning).toBeLessThan(normal);
    expect(critical).toBeLessThan(warning);
  });

  it('penalizes very expensive items', () => {
    const base = { isWarning: false, isCritical: false };
    const cheap = calculatePriorityScore(
      { type: 'file', priority: 'high', tokenCost: 100 },
      base
    );
    const expensive = calculatePriorityScore(
      { type: 'file', priority: 'high', tokenCost: 6000 },
      base
    );
    expect(expensive).toBe(cheap - 10);
  });
});

describe('findUnloadCandidates', () => {
  const options = {
    eligiblePriorities: ['low', 'medium'] as const,
    minAccessCount: 1,
    minTimeSinceAccess: 300000, // 5 min
    now: NOW,
  };

  it('never selects critical items', () => {
    const items = [
      item({ id: 'a', priority: 'critical', tokenCost: 5000, lastAccessedAt: new Date(NOW - 999999) }),
    ];
    expect(findUnloadCandidates(items, 1000, options)).toHaveLength(0);
  });

  it('selects lowest-priority, stalest items first until enough is freed', () => {
    const items = [
      item({ id: 'high', priority: 'high', tokenCost: 3000, lastAccessedAt: new Date(NOW - 999999) }),
      item({ id: 'low-old', priority: 'low', tokenCost: 800, lastAccessedAt: new Date(NOW - 900000) }),
      item({ id: 'low-older', priority: 'low', tokenCost: 800, lastAccessedAt: new Date(NOW - 999999) }),
      item({ id: 'medium', priority: 'medium', tokenCost: 800, lastAccessedAt: new Date(NOW - 900000) }),
    ];
    const chosen = findUnloadCandidates(items, 1000, { ...options, eligiblePriorities: ['low', 'medium'] });
    // low priority comes first; oldest low first; needs >=1000 so two low items.
    expect(chosen.map((c) => c.id)).toEqual(['low-older', 'low-old']);
  });

  it('skips items accessed too recently (min time since access)', () => {
    const items = [
      item({ id: 'recent', priority: 'low', tokenCost: 2000, lastAccessedAt: new Date(NOW - 1000) }),
    ];
    expect(findUnloadCandidates(items, 1000, options)).toHaveLength(0);
  });

  it('returns fewer than needed when not enough eligible items exist', () => {
    const items = [
      item({ id: 'only', priority: 'low', tokenCost: 500, lastAccessedAt: new Date(NOW - 999999) }),
    ];
    const chosen = findUnloadCandidates(items, 5000, options);
    expect(chosen.map((c) => c.id)).toEqual(['only']);
  });
});

describe('generateOptimizationSuggestions', () => {
  it('suggests unloading rarely accessed items when near limit (Test Plan)', () => {
    const items = [
      item({ id: '1', type: 'skill', priority: 'low', tokenCost: 4000, accessCount: 0 }),
      item({ id: '2', type: 'skill', priority: 'medium', tokenCost: 2000, accessCount: 0 }),
    ];
    const suggestions = generateOptimizationSuggestions(items, { now: NOW });
    const unload = suggestions.find((s) => s.type === 'unload');
    expect(unload).toBeDefined();
    expect(unload!.estimatedSavings).toBe(6000);
    expect(unload!.affectedItems).toHaveLength(2);
  });

  it('never suggests unloading critical items', () => {
    const items = [item({ type: 'skill', priority: 'critical', accessCount: 0 })];
    const suggestions = generateOptimizationSuggestions(items, { now: NOW });
    expect(suggestions.find((s) => s.type === 'unload')).toBeUndefined();
  });

  it('suggests compressing large uncompressed files', () => {
    const items = [
      item({ type: 'file', tokenCost: 3000, accessCount: 5, metadata: {} }),
    ];
    const suggestions = generateOptimizationSuggestions(items, {
      now: NOW,
      compressionThreshold: 2000,
    });
    const compress = suggestions.find((s) => s.type === 'compress');
    expect(compress).toBeDefined();
    expect(compress!.estimatedSavings).toBe(1800); // 3000 * 0.6
  });

  it('does not suggest compressing already-compressed files', () => {
    const items = [
      item({ type: 'file', tokenCost: 3000, accessCount: 5, metadata: { compressed: true } }),
    ];
    const suggestions = generateOptimizationSuggestions(items, { now: NOW });
    expect(suggestions.find((s) => s.type === 'compress')).toBeUndefined();
  });

  it('suggests summarizing more than two old messages', () => {
    const old = new Date(NOW - 700000); // >10 min
    const items = [
      item({ type: 'message', tokenCost: 500, accessCount: 5, lastAccessedAt: old }),
      item({ type: 'message', tokenCost: 500, accessCount: 5, lastAccessedAt: old }),
      item({ type: 'message', tokenCost: 500, accessCount: 5, lastAccessedAt: old }),
    ];
    const suggestions = generateOptimizationSuggestions(items, { now: NOW });
    const summarize = suggestions.find((s) => s.type === 'summarize');
    expect(summarize).toBeDefined();
    expect(summarize!.estimatedSavings).toBe(Math.round(1500 * 0.7));
  });

  it('ranks suggestions high -> medium -> low', () => {
    const old = new Date(NOW - 700000);
    const items = [
      // low-access unload (high)
      item({ id: 'u', type: 'file', priority: 'low', tokenCost: 100, accessCount: 0, metadata: {} }),
      // old messages summarize (medium)
      item({ id: 'm1', type: 'message', tokenCost: 100, accessCount: 5, lastAccessedAt: old }),
      item({ id: 'm2', type: 'message', tokenCost: 100, accessCount: 5, lastAccessedAt: old }),
      item({ id: 'm3', type: 'message', tokenCost: 100, accessCount: 5, lastAccessedAt: old }),
      // 4 skills in same category consolidate (low)
      item({ id: 's1', type: 'skill', tokenCost: 100, accessCount: 5, metadata: { summary: 'git' } }),
      item({ id: 's2', type: 'skill', tokenCost: 100, accessCount: 5, metadata: { summary: 'git' } }),
      item({ id: 's3', type: 'skill', tokenCost: 100, accessCount: 5, metadata: { summary: 'git' } }),
      item({ id: 's4', type: 'skill', tokenCost: 100, accessCount: 5, metadata: { summary: 'git' } }),
    ];
    const suggestions = generateOptimizationSuggestions(items, { now: NOW });
    const priorities = suggestions.map((s) => s.priority);
    const order = { high: 0, medium: 1, low: 2 } as const;
    for (let i = 1; i < priorities.length; i++) {
      expect(order[priorities[i]]).toBeGreaterThanOrEqual(order[priorities[i - 1]]);
    }
    expect(suggestions.some((s) => s.type === 'consolidate')).toBe(true);
  });

  it('returns no suggestions for a lean, well-used context', () => {
    const items = [
      item({ type: 'skill', tokenCost: 500, accessCount: 10, priority: 'high' }),
    ];
    const suggestions = generateOptimizationSuggestions(items, { now: NOW });
    expect(suggestions).toHaveLength(0);
  });
});
