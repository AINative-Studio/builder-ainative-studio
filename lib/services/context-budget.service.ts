/**
 * Context Budget Manager Service
 *
 * Provides comprehensive context budget management including:
 * - Real-time token tracking
 * - Smart loading decisions
 * - Budget optimization
 * - Auto-unload functionality
 * - Pre-load cost calculation
 *
 * Based on GitHub Issue #20: Context Budget Manager
 */

import { db } from '@/lib/db';
import {
  budget_tracking,
  context_items,
  budget_events,
  budget_configurations
} from '@/lib/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { estimateTokens } from './token-counter.service';
import { logger } from '../logger';
import type {
  ContextBudget,
  ContextItem,
  BudgetAllocation,
  PreLoadCost,
  OptimizationSuggestion,
  LoadingDecision,
  BudgetStatistics,
  BudgetConfiguration as BudgetConfig,
  BudgetTrackingEvent,
  ContextItemType,
  ContextItemPriority,
  BudgetCategory,
} from '@/lib/types/context-budget';

/**
 * Default budget configuration
 */
const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  totalTokens: 128000,
  thresholds: [
    {
      type: 'warning',
      percentage: 80,
      action: 'alert',
      enabled: true,
      message: 'Token usage is above 80%. Consider optimizing context.',
    },
    {
      type: 'critical',
      percentage: 95,
      action: 'auto-unload',
      enabled: true,
      message: 'Token usage is critical! Auto-unloading low-priority items.',
    },
  ],
  autoUnload: {
    enabled: true,
    minAccessCount: 1,
    minTimeSinceAccess: 300000, // 5 minutes
    priorities: ['low', 'medium'],
  },
  compression: {
    enabled: true,
    autoCompress: false,
    minFileSizeForCompression: 10000, // 10KB
    compressionThreshold: 2000, // tokens
  },
  categoryPreferences: {
    baseline: { maxPercentage: 20, priority: 100 },
    skills: { maxPercentage: 30, priority: 90 },
    files: { maxPercentage: 25, priority: 80 },
    tools: { maxPercentage: 15, priority: 70 },
    history: { maxPercentage: 20, priority: 60 },
    other: { maxPercentage: 10, priority: 50 },
  },
};

/**
 * Priority scores for loading decisions
 */
const PRIORITY_SCORES: Record<ContextItemPriority, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
};

export class ContextBudgetService {
  /**
   * Get or create budget tracking for a session
   */
  async getBudget(sessionId: string, userId: string): Promise<ContextBudget> {
    // Get budget configuration
    const config = await this.getUserConfig(userId);

    // Get or create budget tracking
    let tracking = await db.query.budget_tracking.findFirst({
      where: eq(budget_tracking.session_id, sessionId),
    });

    if (!tracking) {
      [tracking] = await db
        .insert(budget_tracking)
        .values({
          session_id: sessionId,
          user_id: userId,
          total_tokens: config.totalTokens,
          used_tokens: 0,
          remaining_tokens: config.totalTokens,
          usage_percentage: 0,
          is_warning: false,
          is_critical: false,
        })
        .returning();
    }

    // Get all loaded items for this session
    const items = await db.query.context_items.findMany({
      where: and(
        eq(context_items.session_id, sessionId),
        eq(context_items.status, 'loaded')
      ),
    });

    // Calculate allocations by category
    const allocations = this.calculateAllocations(items, tracking.total_tokens);

    return {
      total: tracking.total_tokens,
      used: tracking.used_tokens,
      remaining: tracking.remaining_tokens,
      allocations,
      usagePercentage: tracking.usage_percentage,
      isWarning: tracking.is_warning,
      isCritical: tracking.is_critical,
      sessionId,
      userId,
      updatedAt: tracking.updated_at,
    };
  }

  /**
   * Track a context item (load, unload, or access)
   */
  async trackItem(
    sessionId: string,
    userId: string,
    item: Omit<ContextItem, 'id' | 'loadedAt'>,
    action: 'load' | 'unload' | 'access'
  ): Promise<{ item: ContextItem; budget: ContextBudget; warnings: string[] }> {
    const warnings: string[] = [];

    if (action === 'load') {
      // Check if item already exists
      const existing = await db.query.context_items.findFirst({
        where: and(
          eq(context_items.session_id, sessionId),
          eq(context_items.name, item.name)
        ),
      });

      if (existing && existing.status === 'loaded') {
        // Just update access count
        await this.updateAccess(existing.id);
        const budget = await this.getBudget(sessionId, userId);
        return {
          item: this.mapDbItemToContextItem(existing),
          budget,
          warnings,
        };
      }

      // Check budget availability
      const budget = await this.getBudget(sessionId, userId);
      if (item.tokenCost > budget.remaining) {
        // Try to auto-unload items
        const unloaded = await this.autoUnloadItems(
          sessionId,
          userId,
          item.tokenCost - budget.remaining
        );

        if (unloaded.length > 0) {
          warnings.push(
            `Auto-unloaded ${unloaded.length} items to make room for ${item.name}`
          );
        } else {
          throw new Error(
            `Insufficient budget: need ${item.tokenCost} tokens, have ${budget.remaining}`
          );
        }
      }

      // Load the item
      const [dbItem] = await db
        .insert(context_items)
        .values({
          session_id: sessionId,
          user_id: userId,
          type: item.type,
          name: item.name,
          token_cost: item.tokenCost,
          priority: item.priority,
          status: 'loaded',
          last_accessed_at: new Date(),
          access_count: 1,
          metadata: item.metadata,
          loaded_at: new Date(),
        })
        .returning();

      // Update budget
      await this.updateBudgetAfterLoad(sessionId, item.tokenCost);

      // Record event
      await this.recordEvent(sessionId, userId, 'load', dbItem.id, item.tokenCost);

      const updatedBudget = await this.getBudget(sessionId, userId);
      return {
        item: this.mapDbItemToContextItem(dbItem),
        budget: updatedBudget,
        warnings,
      };
    } else if (action === 'unload') {
      // Find and unload the item
      const dbItem = await db.query.context_items.findFirst({
        where: and(
          eq(context_items.session_id, sessionId),
          eq(context_items.name, item.name),
          eq(context_items.status, 'loaded')
        ),
      });

      if (!dbItem) {
        throw new Error(`Item ${item.name} not found or already unloaded`);
      }

      // Unload
      await db
        .update(context_items)
        .set({ status: 'unloaded' })
        .where(eq(context_items.id, dbItem.id));

      // Update budget
      await this.updateBudgetAfterUnload(sessionId, dbItem.token_cost);

      // Record event
      await this.recordEvent(sessionId, userId, 'unload', dbItem.id, -dbItem.token_cost);

      const updatedBudget = await this.getBudget(sessionId, userId);
      return {
        item: this.mapDbItemToContextItem({ ...dbItem, status: 'unloaded' }),
        budget: updatedBudget,
        warnings,
      };
    } else {
      // Access - just update timestamp and count
      const dbItem = await db.query.context_items.findFirst({
        where: and(
          eq(context_items.session_id, sessionId),
          eq(context_items.name, item.name)
        ),
      });

      if (!dbItem) {
        throw new Error(`Item ${item.name} not found`);
      }

      await this.updateAccess(dbItem.id);

      const budget = await this.getBudget(sessionId, userId);
      return {
        item: this.mapDbItemToContextItem(dbItem),
        budget,
        warnings,
      };
    }
  }

  /**
   * Calculate pre-load cost and availability
   */
  async calculatePreLoadCost(
    sessionId: string,
    userId: string,
    item: Omit<ContextItem, 'id' | 'status' | 'loadedAt'>
  ): Promise<PreLoadCost> {
    const budget = await this.getBudget(sessionId, userId);
    const canLoad = item.tokenCost <= budget.remaining;

    const result: PreLoadCost = {
      item,
      estimatedCost: item.tokenCost,
      canLoad,
      budgetAfterLoad: {
        used: budget.used + item.tokenCost,
        remaining: budget.remaining - item.tokenCost,
        usagePercentage: Math.round(
          ((budget.used + item.tokenCost) / budget.total) * 100
        ),
      },
    };

    if (!canLoad) {
      result.reason = `Insufficient budget: need ${item.tokenCost} tokens, have ${budget.remaining}`;

      // Find items that could be unloaded
      const items = await db.query.context_items.findMany({
        where: and(
          eq(context_items.session_id, sessionId),
          eq(context_items.status, 'loaded')
        ),
        orderBy: [desc(context_items.last_accessed_at)],
      });

      const suggestedUnloads: ContextItem[] = [];
      let freedTokens = 0;

      for (const dbItem of items) {
        if (dbItem.priority === 'critical') continue;

        suggestedUnloads.push(this.mapDbItemToContextItem(dbItem));
        freedTokens += dbItem.token_cost;

        if (freedTokens >= item.tokenCost) break;
      }

      result.suggestedUnloads = suggestedUnloads;
    }

    return result;
  }

  /**
   * Get optimization suggestions
   */
  async getOptimizationSuggestions(
    sessionId: string,
    userId: string,
    aggressiveness: 'conservative' | 'moderate' | 'aggressive' = 'moderate'
  ): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];

    // Get loaded items
    const items = await db.query.context_items.findMany({
      where: and(
        eq(context_items.session_id, sessionId),
        eq(context_items.status, 'loaded')
      ),
    });

    const budget = await this.getBudget(sessionId, userId);
    const config = await this.getUserConfig(userId);

    // Suggestion 1: Unload low-access items
    const lowAccessThreshold = aggressiveness === 'conservative' ? 0 : aggressiveness === 'moderate' ? 1 : 2;
    const lowAccessItems = items.filter(
      (item) =>
        (item.access_count || 0) <= lowAccessThreshold &&
        item.priority !== 'critical'
    );

    if (lowAccessItems.length > 0) {
      suggestions.push({
        type: 'unload',
        priority: 'high',
        description: `Unload ${lowAccessItems.length} rarely accessed items`,
        affectedItems: lowAccessItems.map(this.mapDbItemToContextItem),
        estimatedSavings: lowAccessItems.reduce((sum, item) => sum + item.token_cost, 0),
        confidence: 0.9,
        autoApplicable: aggressiveness === 'aggressive',
        reasoning: `These items have been accessed ${lowAccessThreshold} or fewer times`,
      });
    }

    // Suggestion 2: Compress large files
    if (config.compression.enabled) {
      const largeFiles = items.filter(
        (item) =>
          item.type === 'file' &&
          item.token_cost >= config.compression.compressionThreshold &&
          !item.metadata?.compressed
      );

      if (largeFiles.length > 0) {
        suggestions.push({
          type: 'compress',
          priority: 'medium',
          description: `Compress ${largeFiles.length} large files`,
          affectedItems: largeFiles.map(this.mapDbItemToContextItem),
          estimatedSavings: Math.round(
            largeFiles.reduce((sum, item) => sum + item.token_cost, 0) * 0.6
          ),
          confidence: 0.75,
          autoApplicable: config.compression.autoCompress,
          reasoning: `Files over ${config.compression.compressionThreshold} tokens can be compressed`,
        });
      }
    }

    // Suggestion 3: Summarize old messages
    const oldMessages = items.filter(
      (item) =>
        item.type === 'message' &&
        item.last_accessed_at &&
        Date.now() - item.last_accessed_at.getTime() > 600000 // 10 minutes
    );

    if (oldMessages.length > 2) {
      suggestions.push({
        type: 'summarize',
        priority: 'medium',
        description: `Summarize ${oldMessages.length} old messages`,
        affectedItems: oldMessages.map(this.mapDbItemToContextItem),
        estimatedSavings: Math.round(
          oldMessages.reduce((sum, item) => sum + item.token_cost, 0) * 0.7
        ),
        confidence: 0.8,
        autoApplicable: false,
        reasoning: 'Old messages can be summarized to save tokens while preserving context',
      });
    }

    // Suggestion 4: Consolidate skills
    const skills = items.filter((item) => item.type === 'skill');
    const skillsByCategory = new Map<string, typeof items>();

    skills.forEach((skill) => {
      const category = skill.metadata?.summary || 'general';
      if (!skillsByCategory.has(category)) {
        skillsByCategory.set(category, []);
      }
      skillsByCategory.get(category)!.push(skill);
    });

    for (const [category, categorySkills] of skillsByCategory) {
      if (categorySkills.length > 3) {
        suggestions.push({
          type: 'consolidate',
          priority: 'low',
          description: `Consolidate ${categorySkills.length} ${category} skills`,
          affectedItems: categorySkills.map(this.mapDbItemToContextItem),
          estimatedSavings: Math.round(
            categorySkills.reduce((sum, item) => sum + item.token_cost, 0) * 0.3
          ),
          confidence: 0.6,
          autoApplicable: false,
          reasoning: 'Multiple similar skills can potentially be consolidated',
        });
      }
    }

    return suggestions.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * Make smart loading decision
   */
  async makeLoadingDecision(
    sessionId: string,
    userId: string,
    item: Omit<ContextItem, 'id' | 'status' | 'loadedAt'>
  ): Promise<LoadingDecision> {
    const budget = await this.getBudget(sessionId, userId);
    const config = await this.getUserConfig(userId);

    // Calculate priority score
    const priorityScore = this.calculatePriorityScore(item, budget);

    // Check if we have budget
    if (item.tokenCost <= budget.remaining) {
      return {
        shouldLoad: true,
        reason: 'Sufficient budget available',
        priorityScore,
      };
    }

    // Need to make room - check if we can auto-unload
    const loadedItems = await db.query.context_items.findMany({
      where: and(
        eq(context_items.session_id, sessionId),
        eq(context_items.status, 'loaded')
      ),
    });

    const unloadCandidates = this.findUnloadCandidates(
      loadedItems,
      item.tokenCost - budget.remaining,
      config
    );

    if (unloadCandidates.length > 0) {
      return {
        shouldLoad: true,
        reason: `Can make room by unloading ${unloadCandidates.length} items`,
        priorityScore,
        itemsToUnload: unloadCandidates.map(this.mapDbItemToContextItem),
      };
    }

    // Check for alternatives
    const alternatives: LoadingDecision['alternatives'] = {};

    if (item.type === 'file' && item.tokenCost > config.compression.compressionThreshold) {
      alternatives.useCompressed = true;
    }

    if (item.type === 'skill') {
      alternatives.loadMetadataOnly = true;
    }

    if (item.priority === 'low' || item.priority === 'medium') {
      alternatives.deferLoad = true;
    }

    return {
      shouldLoad: false,
      reason: 'Insufficient budget and cannot auto-unload enough items',
      priorityScore,
      alternatives,
    };
  }

  /**
   * Auto-unload items to free up tokens
   */
  private async autoUnloadItems(
    sessionId: string,
    userId: string,
    tokensNeeded: number
  ): Promise<ContextItem[]> {
    const config = await this.getUserConfig(userId);

    if (!config.autoUnload.enabled) {
      return [];
    }

    const items = await db.query.context_items.findMany({
      where: and(
        eq(context_items.session_id, sessionId),
        eq(context_items.status, 'loaded')
      ),
      orderBy: [desc(context_items.last_accessed_at)],
    });

    const candidates = this.findUnloadCandidates(items, tokensNeeded, config);
    const unloaded: ContextItem[] = [];

    for (const candidate of candidates) {
      await db
        .update(context_items)
        .set({ status: 'unloaded' })
        .where(eq(context_items.id, candidate.id));

      await this.recordEvent(sessionId, userId, 'unload', candidate.id, -candidate.token_cost);

      unloaded.push(this.mapDbItemToContextItem(candidate));
    }

    if (unloaded.length > 0) {
      const totalFreed = unloaded.reduce((sum, item) => sum + item.tokenCost, 0);
      await this.updateBudgetAfterUnload(sessionId, totalFreed);
    }

    return unloaded;
  }

  /**
   * Find candidates for unloading
   */
  private findUnloadCandidates(
    items: any[],
    tokensNeeded: number,
    config: BudgetConfig
  ): any[] {
    const candidates: any[] = [];
    let freedTokens = 0;
    const now = Date.now();

    // Sort by priority (low first) and last access time
    const sorted = [...items].sort((a, b) => {
      const aPriority = PRIORITY_SCORES[a.priority as ContextItemPriority] || 0;
      const bPriority = PRIORITY_SCORES[b.priority as ContextItemPriority] || 0;

      if (aPriority !== bPriority) {
        return aPriority - bPriority; // Lower priority first
      }

      const aTime = a.last_accessed_at?.getTime() || 0;
      const bTime = b.last_accessed_at?.getTime() || 0;
      return aTime - bTime; // Older first
    });

    for (const item of sorted) {
      // Skip critical items
      if (item.priority === 'critical') continue;

      // Check if eligible for auto-unload
      const timeSinceAccess = item.last_accessed_at
        ? now - item.last_accessed_at.getTime()
        : Infinity;

      const isEligible =
        config.autoUnload.priorities.includes(item.priority) &&
        (item.access_count || 0) >= config.autoUnload.minAccessCount &&
        timeSinceAccess >= config.autoUnload.minTimeSinceAccess;

      if (!isEligible) continue;

      candidates.push(item);
      freedTokens += item.token_cost;

      if (freedTokens >= tokensNeeded) break;
    }

    return candidates;
  }

  /**
   * Calculate priority score for loading decision
   */
  private calculatePriorityScore(
    item: Omit<ContextItem, 'id' | 'status' | 'loadedAt'>,
    budget: ContextBudget
  ): number {
    let score = PRIORITY_SCORES[item.priority] || 0;

    // Adjust for budget state
    if (budget.isCritical) {
      score *= 0.5; // Penalize loading in critical state
    } else if (budget.isWarning) {
      score *= 0.75; // Penalize loading in warning state
    }

    // Adjust for type importance
    const typeBonus: Record<ContextItemType, number> = {
      baseline: 20,
      skill: 15,
      tool: 10,
      file: 5,
      message: 3,
      history: 1,
    };

    score += typeBonus[item.type] || 0;

    // Penalize expensive items
    if (item.tokenCost > 5000) {
      score -= 10;
    }

    return score;
  }

  /**
   * Calculate budget allocations by category
   */
  private calculateAllocations(
    items: any[],
    totalBudget: number
  ): BudgetAllocation[] {
    const categories: Map<BudgetCategory, { tokens: number; count: number }> = new Map();

    // Initialize all categories
    const allCategories: BudgetCategory[] = [
      'baseline',
      'skills',
      'files',
      'history',
      'tools',
      'other',
    ];

    allCategories.forEach((cat) => {
      categories.set(cat, { tokens: 0, count: 0 });
    });

    // Aggregate by category
    items.forEach((item) => {
      const category = this.mapTypeToCategory(item.type);
      const current = categories.get(category)!;
      current.tokens += item.token_cost;
      current.count += 1;
    });

    // Build allocations
    return Array.from(categories.entries()).map(([category, data]) => ({
      category,
      tokens: data.tokens,
      percentage: totalBudget > 0 ? Math.round((data.tokens / totalBudget) * 100) : 0,
      itemCount: data.count,
      isOverBudget: false, // TODO: Check against category preferences
    }));
  }

  /**
   * Map item type to budget category
   */
  private mapTypeToCategory(type: string): BudgetCategory {
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

  /**
   * Update budget after loading item
   */
  private async updateBudgetAfterLoad(sessionId: string, tokenDelta: number): Promise<void> {
    const tracking = await db.query.budget_tracking.findFirst({
      where: eq(budget_tracking.session_id, sessionId),
    });

    if (!tracking) return;

    const used = tracking.used_tokens + tokenDelta;
    const remaining = tracking.total_tokens - used;
    const percentage = Math.round((used / tracking.total_tokens) * 100);

    await db
      .update(budget_tracking)
      .set({
        used_tokens: used,
        remaining_tokens: remaining,
        usage_percentage: percentage,
        is_warning: percentage >= 80,
        is_critical: percentage >= 95,
        updated_at: new Date(),
      })
      .where(eq(budget_tracking.session_id, sessionId));
  }

  /**
   * Update budget after unloading item
   */
  private async updateBudgetAfterUnload(sessionId: string, tokenDelta: number): Promise<void> {
    await this.updateBudgetAfterLoad(sessionId, -tokenDelta);
  }

  /**
   * Update item access timestamp and count
   */
  private async updateAccess(itemId: string): Promise<void> {
    await db
      .update(context_items)
      .set({
        last_accessed_at: new Date(),
        access_count: sql`${context_items.access_count} + 1`,
      })
      .where(eq(context_items.id, itemId));
  }

  /**
   * Record a budget event
   */
  private async recordEvent(
    sessionId: string,
    userId: string,
    eventType: string,
    itemId: string,
    tokenDelta: number
  ): Promise<void> {
    const tracking = await db.query.budget_tracking.findFirst({
      where: eq(budget_tracking.session_id, sessionId),
    });

    if (!tracking) return;

    await db.insert(budget_events).values({
      session_id: sessionId,
      user_id: userId,
      event_type: eventType,
      item_id: itemId,
      token_delta: tokenDelta,
      budget_snapshot: {
        total: tracking.total_tokens,
        used: tracking.used_tokens,
        remaining: tracking.remaining_tokens,
        usagePercentage: tracking.usage_percentage,
      },
    });
  }

  /**
   * Get user budget configuration
   */
  private async getUserConfig(userId: string): Promise<BudgetConfig> {
    const dbConfig = await db.query.budget_configurations.findFirst({
      where: eq(budget_configurations.user_id, userId),
    });

    if (!dbConfig) {
      return DEFAULT_BUDGET_CONFIG;
    }

    return {
      totalTokens: dbConfig.total_tokens,
      thresholds: [
        {
          type: 'warning',
          percentage: dbConfig.warning_threshold,
          action: 'alert',
          enabled: true,
        },
        {
          type: 'critical',
          percentage: dbConfig.critical_threshold,
          action: 'auto-unload',
          enabled: true,
        },
      ],
      autoUnload: {
        enabled: dbConfig.auto_unload_enabled,
        minAccessCount: dbConfig.auto_unload_min_access_count,
        minTimeSinceAccess: dbConfig.auto_unload_min_time_ms,
        priorities: ['low', 'medium'],
      },
      compression: {
        enabled: dbConfig.compression_enabled,
        autoCompress: dbConfig.auto_compress,
        minFileSizeForCompression: 10000,
        compressionThreshold: dbConfig.compression_threshold,
      },
      categoryPreferences: dbConfig.category_preferences || DEFAULT_BUDGET_CONFIG.categoryPreferences,
    };
  }

  /**
   * Map database item to ContextItem type
   */
  private mapDbItemToContextItem(dbItem: any): ContextItem {
    return {
      id: dbItem.id,
      type: dbItem.type as ContextItemType,
      name: dbItem.name,
      tokenCost: dbItem.token_cost,
      priority: dbItem.priority as ContextItemPriority,
      status: dbItem.status,
      lastAccessedAt: dbItem.last_accessed_at,
      accessCount: dbItem.access_count,
      metadata: dbItem.metadata,
      loadedAt: dbItem.loaded_at,
      sessionId: dbItem.session_id,
      userId: dbItem.user_id,
    };
  }

  /**
   * Get item by ID
   */
  async getItemById(itemId: string): Promise<ContextItem | null> {
    const dbItem = await db.query.context_items.findFirst({
      where: eq(context_items.id, itemId),
    });

    if (!dbItem) return null;

    return this.mapDbItemToContextItem(dbItem);
  }

  /**
   * Get budget statistics for a session
   */
  async getBudgetStatistics(sessionId: string, userId: string): Promise<BudgetStatistics> {
    const items = await db.query.context_items.findMany({
      where: eq(context_items.session_id, sessionId),
    });

    const events = await db.query.budget_events.findMany({
      where: eq(budget_events.session_id, sessionId),
      orderBy: [desc(budget_events.created_at)],
    });

    const loadedCount = items.filter((i) => i.status === 'loaded').length;
    const unloadedCount = items.filter((i) => i.status === 'unloaded').length;

    const tokenUsages = events.map((e) => e.budget_snapshot.used);
    const peakUsage = tokenUsages.length > 0 ? Math.max(...tokenUsages) : 0;
    const averageUsage =
      tokenUsages.length > 0
        ? Math.round(tokenUsages.reduce((a, b) => a + b, 0) / tokenUsages.length)
        : 0;

    const mostExpensive = items.sort((a, b) => b.token_cost - a.token_cost)[0];
    const leastUsed = items
      .filter((i) => i.status === 'loaded')
      .sort((a, b) => (a.access_count || 0) - (b.access_count || 0))
      .slice(0, 5);

    const optimizationEvents = events.filter((e) => e.event_type === 'optimization_applied');

    const timeRange = {
      start: events.length > 0 ? events[events.length - 1].created_at : new Date(),
      end: events.length > 0 ? events[0].created_at : new Date(),
    };

    return {
      id: sessionId,
      totalItemsLoaded: loadedCount,
      totalItemsUnloaded: unloadedCount,
      peakUsage,
      averageUsage,
      mostExpensiveItem: mostExpensive ? this.mapDbItemToContextItem(mostExpensive) : undefined,
      leastUsedItems: leastUsed.map(this.mapDbItemToContextItem),
      optimizationsApplied: optimizationEvents.length,
      tokensSaved: 0, // TODO: Calculate from events
      efficiencyScore: 0, // TODO: Calculate efficiency score
      timeRange,
    };
  }
}

export const contextBudgetService = new ContextBudgetService();
