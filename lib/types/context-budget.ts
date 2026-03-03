/**
 * Context Budget Manager Types
 *
 * Defines types for the context budget management system that helps users
 * optimize token usage through smart loading and real-time tracking.
 *
 * Based on GitHub Issue #20: Context Budget Manager
 */

/**
 * Priority levels for context items
 * Determines loading order and auto-unload candidates
 */
export type ContextItemPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * Types of context items that consume tokens
 */
export type ContextItemType = 'skill' | 'file' | 'message' | 'tool' | 'baseline' | 'history';

/**
 * Status of a context item in the current session
 */
export type ContextItemStatus = 'loaded' | 'unloaded' | 'pending' | 'failed';

/**
 * Budget categories for token allocation
 */
export type BudgetCategory =
  | 'baseline'        // System prompts, base configuration
  | 'skills'          // Agent skills and knowledge
  | 'files'           // User-uploaded files and documents
  | 'history'         // Conversation history
  | 'tools'           // Tool definitions and schemas
  | 'other';          // Miscellaneous context

/**
 * Individual context item that consumes tokens
 */
export interface ContextItem {
  /** Unique identifier for the item */
  id: string;

  /** Type of context item */
  type: ContextItemType;

  /** Human-readable name */
  name: string;

  /** Estimated token cost */
  tokenCost: number;

  /** Loading priority */
  priority: ContextItemPriority;

  /** Current load status */
  status: ContextItemStatus;

  /** When was it last accessed */
  lastAccessedAt?: Date;

  /** How many times accessed in session */
  accessCount?: number;

  /** Optional metadata */
  metadata?: {
    path?: string;           // File path
    skillId?: string;        // Skill identifier
    messageId?: string;      // Message identifier
    summary?: string;        // Brief summary of content
    compressed?: boolean;    // Is this a compressed version
    originalCost?: number;   // Original token cost before compression
  };

  /** When was it loaded */
  loadedAt?: Date;

  /** Session ID this item belongs to */
  sessionId?: string;

  /** User ID who loaded this item */
  userId?: string;
}

/**
 * Budget allocation for a specific category
 */
export interface BudgetAllocation {
  /** Category name */
  category: BudgetCategory;

  /** Tokens allocated to this category */
  tokens: number;

  /** Percentage of total budget */
  percentage: number;

  /** Number of items in this category */
  itemCount: number;

  /** Is this category over budget */
  isOverBudget?: boolean;
}

/**
 * Overall context budget tracking
 */
export interface ContextBudget {
  /** Total token capacity */
  total: number;

  /** Tokens currently in use */
  used: number;

  /** Remaining available tokens */
  remaining: number;

  /** Budget allocations by category */
  allocations: BudgetAllocation[];

  /** Percentage of budget used */
  usagePercentage: number;

  /** Is budget in warning state (>80%) */
  isWarning: boolean;

  /** Is budget critical (>95%) */
  isCritical: boolean;

  /** Session ID */
  sessionId: string;

  /** User ID */
  userId: string;

  /** Last updated timestamp */
  updatedAt: Date;
}

/**
 * Pre-load cost calculation result
 */
export interface PreLoadCost {
  /** Item being calculated */
  item: Omit<ContextItem, 'id' | 'status' | 'loadedAt'>;

  /** Estimated token cost */
  estimatedCost: number;

  /** Can this item be loaded with current budget */
  canLoad: boolean;

  /** Reason if cannot load */
  reason?: string;

  /** Would need to unload these items to make room */
  suggestedUnloads?: ContextItem[];

  /** Budget state after loading */
  budgetAfterLoad?: {
    used: number;
    remaining: number;
    usagePercentage: number;
  };
}

/**
 * Optimization suggestion for reducing token usage
 */
export interface OptimizationSuggestion {
  /** Type of optimization */
  type: 'unload' | 'compress' | 'summarize' | 'consolidate';

  /** Priority of this suggestion */
  priority: 'high' | 'medium' | 'low';

  /** Description of the suggestion */
  description: string;

  /** Items affected by this suggestion */
  affectedItems: ContextItem[];

  /** Estimated token savings */
  estimatedSavings: number;

  /** Confidence score (0-1) */
  confidence: number;

  /** Can this be auto-applied */
  autoApplicable: boolean;

  /** Detailed reasoning */
  reasoning?: string;
}

/**
 * Budget threshold configuration
 */
export interface BudgetThreshold {
  /** Threshold type */
  type: 'warning' | 'critical' | 'custom';

  /** Percentage threshold (0-100) */
  percentage: number;

  /** Action to take when threshold is reached */
  action: 'alert' | 'auto-unload' | 'block-load' | 'notify';

  /** Is this threshold enabled */
  enabled: boolean;

  /** Custom message for this threshold */
  message?: string;
}

/**
 * Budget tracking event for history
 */
export interface BudgetTrackingEvent {
  /** Event ID */
  id: string;

  /** Session ID */
  sessionId: string;

  /** User ID */
  userId: string;

  /** Event type */
  eventType: 'load' | 'unload' | 'threshold_reached' | 'optimization_applied';

  /** Item involved in event */
  itemId?: string;

  /** Token delta (positive for load, negative for unload) */
  tokenDelta: number;

  /** Budget state after event */
  budgetSnapshot: {
    total: number;
    used: number;
    remaining: number;
    usagePercentage: number;
  };

  /** Event timestamp */
  timestamp: Date;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Budget statistics for a session or user
 */
export interface BudgetStatistics {
  /** Session or user ID */
  id: string;

  /** Total items loaded */
  totalItemsLoaded: number;

  /** Total items unloaded */
  totalItemsUnloaded: number;

  /** Peak token usage */
  peakUsage: number;

  /** Average token usage */
  averageUsage: number;

  /** Most expensive item */
  mostExpensiveItem?: ContextItem;

  /** Least used items */
  leastUsedItems?: ContextItem[];

  /** Total optimizations applied */
  optimizationsApplied: number;

  /** Total tokens saved through optimization */
  tokensSaved: number;

  /** Budget efficiency score (0-100) */
  efficiencyScore: number;

  /** Time range for statistics */
  timeRange: {
    start: Date;
    end: Date;
  };
}

/**
 * Smart loading decision result
 */
export interface LoadingDecision {
  /** Should this item be loaded */
  shouldLoad: boolean;

  /** Reason for the decision */
  reason: string;

  /** Priority score (higher = more important to load) */
  priorityScore: number;

  /** Items to unload to make room */
  itemsToUnload?: ContextItem[];

  /** Alternative suggestions */
  alternatives?: {
    useCompressed?: boolean;
    loadMetadataOnly?: boolean;
    deferLoad?: boolean;
  };
}

/**
 * Budget configuration
 */
export interface BudgetConfiguration {
  /** Total token budget */
  totalTokens: number;

  /** Threshold configurations */
  thresholds: BudgetThreshold[];

  /** Auto-unload settings */
  autoUnload: {
    enabled: boolean;
    minAccessCount: number;      // Minimum access count before eligible for unload
    minTimeSinceAccess: number;  // Minimum time since last access (ms)
    priorities: ContextItemPriority[];  // Priorities eligible for auto-unload
  };

  /** Category allocation preferences */
  categoryPreferences?: {
    [K in BudgetCategory]?: {
      maxPercentage?: number;  // Max percentage of budget
      priority?: number;        // Category priority (higher = more important)
    };
  };

  /** Compression settings */
  compression: {
    enabled: boolean;
    autoCompress: boolean;
    minFileSizeForCompression: number;  // Bytes
    compressionThreshold: number;        // Token count threshold
  };
}

/**
 * Budget report for export/visualization
 */
export interface BudgetReport {
  /** Report ID */
  id: string;

  /** Report generation timestamp */
  generatedAt: Date;

  /** Time range covered */
  timeRange: {
    start: Date;
    end: Date;
  };

  /** Current budget state */
  currentBudget: ContextBudget;

  /** Statistics */
  statistics: BudgetStatistics;

  /** All loaded items */
  loadedItems: ContextItem[];

  /** Recent events */
  recentEvents: BudgetTrackingEvent[];

  /** Optimization suggestions */
  suggestions: OptimizationSuggestion[];

  /** Historical usage data */
  usageHistory: {
    timestamp: Date;
    used: number;
    total: number;
    usagePercentage: number;
  }[];
}

/**
 * API request/response types
 */

export interface GetBudgetRequest {
  sessionId: string;
  userId: string;
  includeHistory?: boolean;
  includeSuggestions?: boolean;
}

export interface GetBudgetResponse {
  success: boolean;
  budget: ContextBudget;
  items: ContextItem[];
  suggestions?: OptimizationSuggestion[];
  history?: BudgetTrackingEvent[];
}

export interface TrackItemRequest {
  sessionId: string;
  userId: string;
  item: Omit<ContextItem, 'id' | 'loadedAt'>;
  action: 'load' | 'unload' | 'access';
}

export interface TrackItemResponse {
  success: boolean;
  item: ContextItem;
  budget: ContextBudget;
  warnings?: string[];
}

export interface OptimizeRequest {
  sessionId: string;
  userId: string;
  aggressiveness?: 'conservative' | 'moderate' | 'aggressive';
  targetReduction?: number; // Target token reduction
}

export interface OptimizeResponse {
  success: boolean;
  suggestions: OptimizationSuggestion[];
  estimatedSavings: number;
  currentUsage: number;
  targetUsage: number;
}

export interface UnloadItemsRequest {
  sessionId: string;
  userId: string;
  itemIds: string[];
  reason?: string;
}

export interface UnloadItemsResponse {
  success: boolean;
  unloadedItems: ContextItem[];
  budget: ContextBudget;
  tokensSaved: number;
}

export interface CalculatePreLoadCostRequest {
  sessionId: string;
  userId: string;
  item: Omit<ContextItem, 'id' | 'status' | 'loadedAt'>;
}

export interface CalculatePreLoadCostResponse {
  success: boolean;
  preLoadCost: PreLoadCost;
}
