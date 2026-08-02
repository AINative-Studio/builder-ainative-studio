/**
 * Context Budget Manager - Pure Logic
 *
 * Framework/DB-agnostic pure functions that power the Context Budget Manager
 * (GitHub Issue #20). These are extracted from `context-budget.service.ts` so
 * that the core budgeting math is:
 *   - deterministic and side-effect free
 *   - fully unit-testable without a database
 *   - reusable by both the server service and any future client-side estimator
 *
 * The DB-bound service (`context-budget.service.ts`) delegates to these helpers
 * for all budget calculations, priority scoring, allocation breakdown, unload
 * candidate selection, and optimization suggestion generation.
 */

import type {
  BudgetAllocation,
  BudgetCategory,
  ContextItem,
  ContextItemPriority,
  ContextItemType,
  OptimizationSuggestion,
} from '@/lib/types/context-budget';

/**
 * A minimal, DB-agnostic shape for a context item. Both the Drizzle row
 * (snake_case) and the API `ContextItem` (camelCase) can be normalized to this
 * before being passed to the pure helpers.
 */
export interface BudgetItemInput {
  id?: string;
  type: ContextItemType | string;
  name?: string;
  /** Token cost (camelCase preferred; snake_case tolerated by normalizer). */
  tokenCost: number;
  priority: ContextItemPriority | string;
  status?: string;
  accessCount?: number;
  lastAccessedAt?: Date | null;
  metadata?: ContextItem['metadata'];
}

/** Warning threshold (percentage of total budget used). */
export const WARNING_THRESHOLD_PCT = 80;
/** Critical threshold (percentage of total budget used). */
export const CRITICAL_THRESHOLD_PCT = 95;

/**
 * Priority scores for loading decisions and unload ordering.
 * Higher = more important to keep loaded.
 */
export const PRIORITY_SCORES: Record<ContextItemPriority, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
};

/**
 * Per-type bonus applied when scoring a load decision. Baseline/skill/tool
 * context is generally more valuable to keep than raw message/history text.
 */
export const TYPE_LOAD_BONUS: Record<ContextItemType, number> = {
  baseline: 20,
  skill: 15,
  tool: 10,
  file: 5,
  message: 3,
  history: 1,
};

/** Default per-category allocation preferences (max % of total budget). */
export const DEFAULT_CATEGORY_MAX_PCT: Record<BudgetCategory, number> = {
  baseline: 20,
  skills: 30,
  files: 25,
  tools: 15,
  history: 20,
  other: 10,
};

/**
 * Map an item type to its budget category.
 */
export function mapTypeToCategory(type: string): BudgetCategory {
  const mapping: Record<string, BudgetCategory> = {
    skill: 'skills',
    file: 'files',
    message: 'history',
    history: 'history',
    tool: 'tools',
    baseline: 'baseline',
  };
  return mapping[type] || 'other';
}

/** Clamp a number into the inclusive [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Derived budget state (used/remaining/percentage/thresholds) for a given
 * total capacity and consumed token count.
 */
export interface BudgetState {
  total: number;
  used: number;
  remaining: number;
  usagePercentage: number;
  isWarning: boolean;
  isCritical: boolean;
}

/**
 * Compute the derived budget state from a total capacity and used tokens.
 *
 * `used` is clamped to [0, total] so callers never observe negative remaining
 * or >100% usage even if upstream accounting drifts.
 */
export function calculateBudgetState(total: number, used: number): BudgetState {
  const safeTotal = Math.max(0, total);
  const safeUsed = clamp(used, 0, safeTotal);
  const remaining = safeTotal - safeUsed;
  const usagePercentage = safeTotal > 0 ? Math.round((safeUsed / safeTotal) * 100) : 0;

  return {
    total: safeTotal,
    used: safeUsed,
    remaining,
    usagePercentage,
    isWarning: usagePercentage >= WARNING_THRESHOLD_PCT,
    isCritical: usagePercentage >= CRITICAL_THRESHOLD_PCT,
  };
}

/**
 * Can an item of `tokenCost` be loaded given `remaining` budget?
 */
export function canLoad(tokenCost: number, remaining: number): boolean {
  return tokenCost <= remaining;
}

/**
 * Score a candidate item for a smart-loading decision. Higher scores are more
 * worth loading. The score blends base priority, budget pressure, type value,
 * and a penalty for very expensive items.
 */
export function calculatePriorityScore(
  item: Pick<BudgetItemInput, 'type' | 'priority' | 'tokenCost'>,
  budget: Pick<BudgetState, 'isWarning' | 'isCritical'>
): number {
  let score = PRIORITY_SCORES[item.priority as ContextItemPriority] ?? 0;

  // Penalize loading while under budget pressure.
  if (budget.isCritical) {
    score *= 0.5;
  } else if (budget.isWarning) {
    score *= 0.75;
  }

  score += TYPE_LOAD_BONUS[item.type as ContextItemType] ?? 0;

  // Penalize very expensive items.
  if (item.tokenCost > 5000) {
    score -= 10;
  }

  return score;
}

/**
 * Aggregate loaded items into per-category budget allocations.
 * All six categories are always represented (zeroed when empty) so UIs can
 * render a stable breakdown.
 */
export function calculateAllocations(
  items: BudgetItemInput[],
  totalBudget: number
): BudgetAllocation[] {
  const allCategories: BudgetCategory[] = [
    'baseline',
    'skills',
    'files',
    'history',
    'tools',
    'other',
  ];

  const totals = new Map<BudgetCategory, { tokens: number; count: number }>();
  allCategories.forEach((cat) => totals.set(cat, { tokens: 0, count: 0 }));

  for (const item of items) {
    const category = mapTypeToCategory(String(item.type));
    const bucket = totals.get(category)!;
    bucket.tokens += item.tokenCost || 0;
    bucket.count += 1;
  }

  return allCategories.map((category) => {
    const data = totals.get(category)!;
    const percentage =
      totalBudget > 0 ? Math.round((data.tokens / totalBudget) * 100) : 0;
    const maxPct = DEFAULT_CATEGORY_MAX_PCT[category];
    return {
      category,
      tokens: data.tokens,
      percentage,
      itemCount: data.count,
      isOverBudget: typeof maxPct === 'number' ? percentage > maxPct : false,
    };
  });
}

/**
 * Options controlling unload-candidate selection.
 */
export interface UnloadCandidateOptions {
  /** Priorities eligible for auto-unload (critical is always excluded). */
  eligiblePriorities: ContextItemPriority[];
  /** Minimum access count before an item is eligible. */
  minAccessCount: number;
  /** Minimum ms since last access before an item is eligible. */
  minTimeSinceAccess: number;
  /** Reference "now" for time-since-access checks (defaults to Date.now()). */
  now?: number;
}

/**
 * Select the set of loaded items to unload in order to free at least
 * `tokensNeeded` tokens, honoring priority (lowest first), recency (oldest
 * first), and eligibility rules. Critical items are never selected.
 *
 * Returns the ordered list of items to unload (may free more than needed by the
 * granularity of the last item, or fewer if not enough eligible items exist).
 */
export function findUnloadCandidates<T extends BudgetItemInput>(
  items: T[],
  tokensNeeded: number,
  options: UnloadCandidateOptions
): T[] {
  const now = options.now ?? Date.now();
  const candidates: T[] = [];
  let freed = 0;

  const sorted = [...items].sort((a, b) => {
    const aPriority = PRIORITY_SCORES[a.priority as ContextItemPriority] ?? 0;
    const bPriority = PRIORITY_SCORES[b.priority as ContextItemPriority] ?? 0;
    if (aPriority !== bPriority) return aPriority - bPriority; // lowest priority first

    const aTime = a.lastAccessedAt ? new Date(a.lastAccessedAt).getTime() : 0;
    const bTime = b.lastAccessedAt ? new Date(b.lastAccessedAt).getTime() : 0;
    return aTime - bTime; // oldest first
  });

  for (const item of sorted) {
    if (item.priority === 'critical') continue;

    const timeSinceAccess = item.lastAccessedAt
      ? now - new Date(item.lastAccessedAt).getTime()
      : Infinity;

    const eligible =
      options.eligiblePriorities.includes(item.priority as ContextItemPriority) &&
      (item.accessCount ?? 0) >= options.minAccessCount &&
      timeSinceAccess >= options.minTimeSinceAccess;

    if (!eligible) continue;

    candidates.push(item);
    freed += item.tokenCost || 0;
    if (freed >= tokensNeeded) break;
  }

  return candidates;
}

/**
 * Options for generating optimization suggestions.
 */
export interface OptimizationOptions {
  aggressiveness?: 'conservative' | 'moderate' | 'aggressive';
  compressionEnabled?: boolean;
  compressionThreshold?: number;
  now?: number;
}

/**
 * Generate ranked optimization suggestions (unload / compress / summarize /
 * consolidate) for a set of loaded items. Pure and deterministic given `now`.
 */
export function generateOptimizationSuggestions(
  items: BudgetItemInput[],
  options: OptimizationOptions = {}
): OptimizationSuggestion[] {
  const {
    aggressiveness = 'moderate',
    compressionEnabled = true,
    compressionThreshold = 2000,
    now = Date.now(),
  } = options;

  const suggestions: OptimizationSuggestion[] = [];

  const asContextItem = (item: BudgetItemInput): ContextItem => ({
    id: item.id ?? '',
    type: item.type as ContextItemType,
    name: item.name ?? '',
    tokenCost: item.tokenCost,
    priority: item.priority as ContextItemPriority,
    status: (item.status as ContextItem['status']) ?? 'loaded',
    lastAccessedAt: item.lastAccessedAt ?? undefined,
    accessCount: item.accessCount,
    metadata: item.metadata,
  });

  // 1. Unload rarely accessed, non-critical items.
  const lowAccessThreshold =
    aggressiveness === 'conservative' ? 0 : aggressiveness === 'moderate' ? 1 : 2;
  const lowAccessItems = items.filter(
    (item) => (item.accessCount ?? 0) <= lowAccessThreshold && item.priority !== 'critical'
  );
  if (lowAccessItems.length > 0) {
    suggestions.push({
      type: 'unload',
      priority: 'high',
      description: `Unload ${lowAccessItems.length} rarely accessed items`,
      affectedItems: lowAccessItems.map(asContextItem),
      estimatedSavings: lowAccessItems.reduce((sum, i) => sum + (i.tokenCost || 0), 0),
      confidence: 0.9,
      autoApplicable: aggressiveness === 'aggressive',
      reasoning: `These items have been accessed ${lowAccessThreshold} or fewer times`,
    });
  }

  // 2. Compress large files.
  if (compressionEnabled) {
    const largeFiles = items.filter(
      (item) =>
        item.type === 'file' &&
        item.tokenCost >= compressionThreshold &&
        !item.metadata?.compressed
    );
    if (largeFiles.length > 0) {
      suggestions.push({
        type: 'compress',
        priority: 'medium',
        description: `Compress ${largeFiles.length} large files`,
        affectedItems: largeFiles.map(asContextItem),
        estimatedSavings: Math.round(
          largeFiles.reduce((sum, i) => sum + (i.tokenCost || 0), 0) * 0.6
        ),
        confidence: 0.75,
        autoApplicable: false,
        reasoning: `Files over ${compressionThreshold} tokens can be compressed`,
      });
    }
  }

  // 3. Summarize old messages.
  const oldMessages = items.filter(
    (item) =>
      item.type === 'message' &&
      item.lastAccessedAt &&
      now - new Date(item.lastAccessedAt).getTime() > 600000 // 10 minutes
  );
  if (oldMessages.length > 2) {
    suggestions.push({
      type: 'summarize',
      priority: 'medium',
      description: `Summarize ${oldMessages.length} old messages`,
      affectedItems: oldMessages.map(asContextItem),
      estimatedSavings: Math.round(
        oldMessages.reduce((sum, i) => sum + (i.tokenCost || 0), 0) * 0.7
      ),
      confidence: 0.8,
      autoApplicable: false,
      reasoning: 'Old messages can be summarized to save tokens while preserving context',
    });
  }

  // 4. Consolidate similar skills.
  const skills = items.filter((item) => item.type === 'skill');
  const byCategory = new Map<string, BudgetItemInput[]>();
  for (const skill of skills) {
    const category = skill.metadata?.summary || 'general';
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category)!.push(skill);
  }
  for (const [category, categorySkills] of byCategory) {
    if (categorySkills.length > 3) {
      suggestions.push({
        type: 'consolidate',
        priority: 'low',
        description: `Consolidate ${categorySkills.length} ${category} skills`,
        affectedItems: categorySkills.map(asContextItem),
        estimatedSavings: Math.round(
          categorySkills.reduce((sum, i) => sum + (i.tokenCost || 0), 0) * 0.3
        ),
        confidence: 0.6,
        autoApplicable: false,
        reasoning: 'Multiple similar skills can potentially be consolidated',
      });
    }
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 } as const;
  return suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}
