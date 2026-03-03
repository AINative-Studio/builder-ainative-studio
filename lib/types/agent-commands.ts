/**
 * Agent Command System Types
 *
 * Defines types for a Cmd+K style command palette that allows users
 * to define and execute parameterized agent workflows.
 *
 * Features:
 * - Templated prompts with variable substitution
 * - Automatic skill loading
 * - Pre-condition validation
 * - Progress tracking with checkpoints
 * - Team sharing and collaboration
 */

import type { AgentSkill } from './agent-skills';

/**
 * Variable definition for command templates
 */
export interface CommandVariable {
  /** Variable name (used in template as {{variableName}}) */
  name: string;

  /** Display label for the variable */
  label: string;

  /** Variable description/help text */
  description?: string;

  /** Variable type */
  type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect' | 'file' | 'url';

  /** Is this variable required? */
  required: boolean;

  /** Default value */
  defaultValue?: string | number | boolean | string[];

  /** For select/multiselect: available options */
  options?: Array<{
    label: string;
    value: string;
    description?: string;
  }>;

  /** Validation regex (for text/url types) */
  validation?: string;

  /** Validation error message */
  validationMessage?: string;

  /** Placeholder text */
  placeholder?: string;
}

/**
 * Pre-condition check for command execution
 */
export interface CommandPreCondition {
  /** Pre-condition ID */
  id: string;

  /** Pre-condition type */
  type: 'file_exists' | 'env_var' | 'tool_available' | 'git_status' | 'custom';

  /** Description of what's being checked */
  description: string;

  /** Configuration for the check */
  config: {
    /** For file_exists: file path pattern */
    filePath?: string;

    /** For env_var: variable name */
    envVar?: string;

    /** For tool_available: tool name */
    tool?: string;

    /** For git_status: required status */
    gitStatus?: 'clean' | 'dirty' | 'branch';

    /** For git_status with branch: branch name pattern */
    branchPattern?: string;

    /** For custom: JavaScript expression to evaluate */
    expression?: string;
  };

  /** Is this a blocking check? */
  blocking: boolean;

  /** Error message if check fails */
  errorMessage?: string;
}

/**
 * Checkpoint in command execution workflow
 */
export interface CommandCheckpoint {
  /** Checkpoint ID */
  id: string;

  /** Display title */
  title: string;

  /** Detailed description */
  description?: string;

  /** Order in the workflow */
  order: number;

  /** Type of checkpoint */
  type: 'info' | 'action' | 'validation' | 'evidence';

  /** Should this checkpoint require user confirmation? */
  requiresConfirmation?: boolean;

  /** Validation rule to run at this checkpoint */
  validationRule?: string;

  /** Evidence attachment points */
  evidenceTypes?: Array<'screenshot' | 'file' | 'log' | 'link'>;
}

/**
 * Command output specification
 */
export interface CommandOutput {
  /** Output type */
  type: 'chat' | 'file' | 'pr' | 'deployment' | 'report';

  /** Output configuration */
  config?: {
    /** For file: target path pattern */
    targetPath?: string;

    /** For pr: target branch */
    targetBranch?: string;

    /** For deployment: platform */
    platform?: string;

    /** For report: format */
    format?: 'markdown' | 'json' | 'html';
  };

  /** Success criteria */
  successCriteria?: string[];
}

/**
 * Command metadata
 */
export interface CommandMetadata {
  /** Command ID */
  id: string;

  /** Display name */
  name: string;

  /** Short description */
  description: string;

  /** Category for organization */
  category: 'development' | 'testing' | 'deployment' | 'documentation' | 'code-review' | 'custom';

  /** Icon name (from lucide-react) */
  icon?: string;

  /** Tags for search and filtering */
  tags: string[];

  /** Author/creator information */
  author: {
    id: string;
    name: string;
    email?: string;
  };

  /** Is this a built-in command? */
  isBuiltIn: boolean;

  /** Is this a team command? */
  isTeam: boolean;

  /** Team/organization ID if team command */
  teamId?: string;

  /** Usage count */
  usageCount: number;

  /** Average execution time (ms) */
  avgExecutionTime?: number;

  /** Success rate (0-1) */
  successRate?: number;

  /** Is this command active/enabled? */
  isActive: boolean;

  /** Keyboard shortcut (optional) */
  shortcut?: string;

  /** Is this command favorited by user? */
  isFavorite?: boolean;

  /** Last used timestamp */
  lastUsedAt?: Date;

  /** Creation timestamp */
  createdAt: Date;

  /** Last updated timestamp */
  updatedAt: Date;
}

/**
 * Full agent command definition
 */
export interface AgentCommand {
  /** Command metadata */
  metadata: CommandMetadata;

  /** Template prompt with variables */
  template: string;

  /** Variables required for this command */
  variables: CommandVariable[];

  /** Skills that should be auto-loaded */
  requiredSkills: string[]; // Skill IDs

  /** Pre-conditions to check before execution */
  preConditions: CommandPreCondition[];

  /** Execution checkpoints/steps */
  checkpoints: CommandCheckpoint[];

  /** Expected output specification */
  output: CommandOutput;

  /** Validation rules to apply */
  validationRules?: string[]; // Rule IDs from enforcement system

  /** Estimated token cost */
  estimatedTokenCost?: number;

  /** Version (semver) */
  version: string;
}

/**
 * Command execution context
 */
export interface CommandExecutionContext {
  /** Command being executed */
  command: AgentCommand;

  /** Variable values provided by user */
  variableValues: Record<string, any>;

  /** Current user */
  userId: string;

  /** Current project/chat */
  projectId?: string;
  chatId?: string;

  /** Git context */
  gitContext?: {
    branch: string;
    hasUncommittedChanges: boolean;
    lastCommitHash?: string;
  };

  /** Environment variables */
  env?: Record<string, string>;

  /** Token budget */
  tokenBudget?: {
    total: number;
    used: number;
    remaining: number;
  };

  /** Execution ID (for tracking) */
  executionId: string;

  /** Started at */
  startedAt: Date;
}

/**
 * Checkpoint execution state
 */
export interface CheckpointState {
  /** Checkpoint ID */
  checkpointId: string;

  /** Status */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

  /** Started at */
  startedAt?: Date;

  /** Completed at */
  completedAt?: Date;

  /** Error message if failed */
  error?: string;

  /** Attached evidence */
  evidence?: Array<{
    type: 'screenshot' | 'file' | 'log' | 'link';
    data: string;
    timestamp: Date;
  }>;

  /** User notes */
  notes?: string;
}

/**
 * Command execution state
 */
export interface CommandExecutionState {
  /** Execution context */
  context: CommandExecutionContext;

  /** Overall status */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

  /** Current checkpoint index */
  currentCheckpointIndex: number;

  /** Checkpoint states */
  checkpointStates: CheckpointState[];

  /** Loaded skills */
  loadedSkills: AgentSkill[];

  /** Pre-condition check results */
  preConditionResults: Array<{
    conditionId: string;
    passed: boolean;
    message?: string;
  }>;

  /** Generated output */
  output?: {
    type: string;
    data: any;
    url?: string;
  };

  /** Execution logs */
  logs: Array<{
    timestamp: Date;
    level: 'info' | 'warning' | 'error';
    message: string;
    data?: any;
  }>;

  /** Total execution time (ms) */
  executionTime?: number;

  /** Completed at */
  completedAt?: Date;

  /** Error details if failed */
  error?: {
    message: string;
    stack?: string;
    checkpoint?: string;
  };
}

/**
 * Command search query
 */
export interface CommandSearchQuery {
  /** Search text (fuzzy match on name, description, tags) */
  query?: string;

  /** Filter by category */
  category?: CommandMetadata['category'];

  /** Filter by tags */
  tags?: string[];

  /** Filter by author */
  authorId?: string;

  /** Only show built-in commands */
  builtInOnly?: boolean;

  /** Only show team commands */
  teamOnly?: boolean;

  /** Only show favorites */
  favoritesOnly?: boolean;

  /** Sort by */
  sortBy?: 'relevance' | 'recent' | 'popular' | 'name' | 'category';

  /** Pagination */
  limit?: number;
  offset?: number;
}

/**
 * Command search result
 */
export interface CommandSearchResult {
  /** Matching commands */
  commands: AgentCommand[];

  /** Total count */
  total: number;

  /** Search time (ms) */
  searchTime: number;

  /** Did the search use fuzzy matching? */
  fuzzyMatch: boolean;
}

/**
 * Command execution history entry
 */
export interface CommandExecutionHistory {
  /** History entry ID */
  id: string;

  /** Command ID */
  commandId: string;

  /** Command name (snapshot) */
  commandName: string;

  /** User ID */
  userId: string;

  /** Execution state (final) */
  executionState: CommandExecutionState;

  /** Was it successful? */
  success: boolean;

  /** Execution time (ms) */
  executionTime: number;

  /** Executed at */
  executedAt: Date;
}

/**
 * Command template for common workflows
 */
export interface CommandTemplate {
  /** Template ID */
  id: string;

  /** Template name */
  name: string;

  /** Template description */
  description: string;

  /** Category */
  category: CommandMetadata['category'];

  /** Template content (partial AgentCommand) */
  template: Partial<AgentCommand>;

  /** Is this a built-in template? */
  isBuiltIn: boolean;

  /** Preview image */
  previewImage?: string;
}

/**
 * Command import/export format
 */
export interface CommandExportFormat {
  /** Format version */
  version: '1.0';

  /** Export timestamp */
  exportedAt: Date;

  /** Exported by */
  exportedBy: {
    userId: string;
    userName: string;
  };

  /** Commands */
  commands: AgentCommand[];

  /** Metadata */
  metadata?: {
    source?: string;
    notes?: string;
  };
}

/**
 * Command validation result
 */
export interface CommandValidationResult {
  /** Is the command valid? */
  valid: boolean;

  /** Validation errors */
  errors: Array<{
    field: string;
    message: string;
    severity: 'error' | 'warning';
  }>;

  /** Validation warnings */
  warnings?: Array<{
    field: string;
    message: string;
  }>;

  /** Suggestions for improvement */
  suggestions?: string[];
}

/**
 * Command palette state
 */
export interface CommandPaletteState {
  /** Is palette open? */
  isOpen: boolean;

  /** Current search query */
  searchQuery: string;

  /** Search results */
  searchResults: AgentCommand[];

  /** Selected command index */
  selectedIndex: number;

  /** Recent commands */
  recentCommands: AgentCommand[];

  /** Favorite commands */
  favoriteCommands: AgentCommand[];

  /** Is loading? */
  isLoading: boolean;

  /** Current view mode */
  viewMode: 'search' | 'recent' | 'favorites' | 'categories';
}

/**
 * Variable prompt state
 */
export interface VariablePromptState {
  /** Is prompt open? */
  isOpen: boolean;

  /** Command being executed */
  command: AgentCommand;

  /** Current variable values */
  variableValues: Record<string, any>;

  /** Validation errors */
  validationErrors: Record<string, string>;

  /** Current step (for multi-step prompts) */
  currentStep: number;

  /** Total steps */
  totalSteps: number;

  /** Is submitting? */
  isSubmitting: boolean;
}

// Export types for React components
export type CommandPaletteProps = {
  /** Is palette open? */
  open: boolean;

  /** On open change */
  onOpenChange: (open: boolean) => void;

  /** On command select */
  onCommandSelect: (command: AgentCommand) => void;

  /** Initial search query */
  initialQuery?: string;

  /** Filter commands */
  filter?: (command: AgentCommand) => boolean;
};

export type CommandEditorProps = {
  /** Command to edit (undefined for new) */
  command?: AgentCommand;

  /** On save */
  onSave: (command: AgentCommand) => Promise<void>;

  /** On cancel */
  onCancel: () => void;

  /** On delete */
  onDelete?: (commandId: string) => Promise<void>;
};

export type CommandExecutionProps = {
  /** Command to execute */
  command: AgentCommand;

  /** Execution context */
  context: CommandExecutionContext;

  /** On execution complete */
  onComplete: (state: CommandExecutionState) => void;

  /** On cancel */
  onCancel: () => void;

  /** Show progress UI? */
  showProgress?: boolean;
};

export type VariablePromptProps = {
  /** Command requiring variables */
  command: AgentCommand;

  /** Initial values */
  initialValues?: Record<string, any>;

  /** On submit */
  onSubmit: (values: Record<string, any>) => void;

  /** On cancel */
  onCancel: () => void;

  /** Show as dialog? */
  asDialog?: boolean;
};

export type CommandProgressProps = {
  /** Execution state */
  executionState: CommandExecutionState;

  /** On cancel execution */
  onCancel?: () => void;

  /** Compact mode? */
  compact?: boolean;
};

export type CommandHistoryProps = {
  /** User ID to filter by */
  userId?: string;

  /** Command ID to filter by */
  commandId?: string;

  /** On history entry select */
  onSelect?: (history: CommandExecutionHistory) => void;

  /** Pagination */
  page?: number;
  pageSize?: number;
};
