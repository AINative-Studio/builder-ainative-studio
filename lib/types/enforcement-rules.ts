/**
 * Rule Enforcement Framework Types
 *
 * Defines types for a comprehensive rule enforcement system that validates
 * agent actions before they're executed (pre-flight checks).
 *
 * Based on .ainative/RULES.MD zero-tolerance enforcement patterns.
 */

export type RuleLevel = 'error' | 'warning' | 'info';

export type RuleContext =
  | 'commit'
  | 'file-create'
  | 'file-edit'
  | 'file-delete'
  | 'pr-create'
  | 'branch-create'
  | 'test-run'
  | 'build'
  | 'deploy';

export interface AgentAction {
  /** Type of action being performed */
  type: RuleContext;

  /** Detailed action data */
  data: {
    // Commit context
    commitMessage?: string;
    branch?: string;
    files?: string[];

    // File context
    filePath?: string;
    fileContent?: string;
    fileType?: string;

    // PR context
    prTitle?: string;
    prDescription?: string;
    baseBranch?: string;
    headBranch?: string;

    // Test context
    testCommand?: string;
    testOutput?: string;

    // Build context
    buildCommand?: string;
    buildOutput?: string;

    // Generic metadata
    metadata?: Record<string, unknown>;
  };

  /** User ID performing the action */
  userId: string;

  /** Project ID */
  projectId: string;

  /** Timestamp */
  timestamp: Date;
}

export interface RuleViolation {
  /** Rule that was violated */
  ruleId: string;

  /** Violation severity */
  level: RuleLevel;

  /** Human-readable message */
  message: string;

  /** Detailed explanation */
  details?: string;

  /** Location of violation (file, line, column) */
  location?: {
    file?: string;
    line?: number;
    column?: number;
    snippet?: string;
  };

  /** Suggested fix */
  suggestion?: string;

  /** Can this be auto-fixed? */
  autoFixable: boolean;

  /** Auto-fix function if available */
  autoFix?: () => Promise<void>;
}

export interface RuleCheckResult {
  /** Rule ID that was checked */
  ruleId: string;

  /** Did the check pass? */
  passed: boolean;

  /** Violations found (if any) */
  violations: RuleViolation[];

  /** Check duration (ms) */
  duration: number;

  /** Additional context */
  context?: Record<string, unknown>;
}

export interface EnforcementRule {
  /** Unique rule identifier */
  id: string;

  /** Rule name */
  name: string;

  /** Rule description */
  description: string;

  /** Severity level */
  level: RuleLevel;

  /** When this rule applies */
  contexts: RuleContext[];

  /** Is this rule enabled? */
  enabled: boolean;

  /** Rule category for organization */
  category:
    | 'git'
    | 'file-placement'
    | 'testing'
    | 'security'
    | 'code-quality'
    | 'documentation'
    | 'database'
    | 'deployment';

  /** Tags for filtering */
  tags: string[];

  /** The actual validation function */
  check: (action: AgentAction) => Promise<RuleCheckResult>;

  /** Optional auto-fix function */
  autoFix?: (action: AgentAction) => Promise<AgentAction>;

  /** Rule documentation URL */
  docsUrl?: string;

  /** Examples of violations */
  examples?: {
    invalid: string;
    valid: string;
    explanation: string;
  }[];
}

export interface RuleSet {
  /** Rule set ID */
  id: string;

  /** Rule set name */
  name: string;

  /** Rule set description */
  description: string;

  /** Rules in this set */
  rules: EnforcementRule[];

  /** Is this a built-in rule set? */
  isBuiltIn: boolean;

  /** Team/organization ID if team rule set */
  teamId?: string;

  /** Version */
  version: string;

  /** Created/updated timestamps */
  createdAt: Date;
  updatedAt: Date;
}

export interface EnforcementReport {
  /** Action that was checked */
  action: AgentAction;

  /** All rule check results */
  results: RuleCheckResult[];

  /** Overall pass/fail */
  passed: boolean;

  /** Total errors */
  errorCount: number;

  /** Total warnings */
  warningCount: number;

  /** Total info */
  infoCount: number;

  /** Total duration (ms) */
  totalDuration: number;

  /** Timestamp */
  timestamp: Date;

  /** Can all violations be auto-fixed? */
  canAutoFix: boolean;

  /** Suggested actions */
  suggestions: string[];
}

export interface RuleConfiguration {
  /** Rule ID */
  ruleId: string;

  /** Override default level? */
  level?: RuleLevel;

  /** Override enabled state? */
  enabled?: boolean;

  /** Custom options for this rule */
  options?: Record<string, unknown>;
}

export interface EnforcementConfig {
  /** Project ID */
  projectId: string;

  /** Active rule sets */
  ruleSets: string[];

  /** Rule-specific configurations */
  ruleConfigs: RuleConfiguration[];

  /** Global settings */
  settings: {
    /** Auto-fix violations when possible? */
    autoFix: boolean;

    /** Fail on warnings? */
    strictMode: boolean;

    /** Continue on errors? */
    continueOnError: boolean;

    /** Max violations before stopping */
    maxViolations?: number;
  };
}

export interface RuleViolationHistory {
  /** Violation ID */
  id: string;

  /** Rule that was violated */
  ruleId: string;

  /** When it happened */
  timestamp: Date;

  /** User who triggered it */
  userId: string;

  /** Project context */
  projectId: string;

  /** Action that caused violation */
  action: AgentAction;

  /** The violation details */
  violation: RuleViolation;

  /** Was it fixed? */
  fixed: boolean;

  /** How was it fixed? */
  fixMethod?: 'auto' | 'manual' | 'ignored';

  /** Time to fix (ms) */
  timeToFix?: number;
}

export interface RuleMetrics {
  /** Rule ID */
  ruleId: string;

  /** Total checks */
  totalChecks: number;

  /** Total violations */
  totalViolations: number;

  /** Violation rate */
  violationRate: number;

  /** Auto-fix success rate */
  autoFixRate: number;

  /** Average check duration (ms) */
  avgCheckDuration: number;

  /** Most common violation types */
  topViolations: {
    message: string;
    count: number;
  }[];

  /** Trend over time */
  trend: 'improving' | 'stable' | 'worsening';
}

// Predefined rule IDs (constants)
export const RULE_IDS = {
  // Git rules
  NO_AI_ATTRIBUTION: 'git/no-ai-attribution',
  COMMIT_MESSAGE_FORMAT: 'git/commit-message-format',
  BRANCH_NAMING: 'git/branch-naming',

  // File placement rules
  NO_ROOT_MD_FILES: 'file-placement/no-root-md-files',
  NO_BACKEND_SCRIPTS: 'file-placement/no-backend-scripts',
  DOCS_IN_SUBDIRS: 'file-placement/docs-in-subdirs',

  // Testing rules
  MANDATORY_TEST_EXECUTION: 'testing/mandatory-execution',
  MIN_COVERAGE_80: 'testing/min-coverage-80',
  INCLUDE_TEST_OUTPUT: 'testing/include-output',

  // Security rules
  NO_SECRETS_IN_CODE: 'security/no-secrets',
  NO_PII_IN_LOGS: 'security/no-pii-logs',
  INPUT_VALIDATION: 'security/input-validation',

  // Code quality rules
  TYPE_HINTS_REQUIRED: 'code-quality/type-hints',
  DOCSTRINGS_PUBLIC: 'code-quality/docstrings',
  NO_CONSOLE_LOG: 'code-quality/no-console-log',

  // Database rules
  USE_SCHEMA_SYNC: 'database/use-schema-sync',
  NO_DIRECT_ALEMBIC: 'database/no-direct-alembic',
  DRY_RUN_FIRST: 'database/dry-run-first',
} as const;

// Export type for rule IDs
export type RuleId = (typeof RULE_IDS)[keyof typeof RULE_IDS];

// Export types for React components
export type RuleViolationListProps = {
  violations: RuleViolation[];
  onAutoFix?: (violation: RuleViolation) => Promise<void>;
  onIgnore?: (violation: RuleViolation) => void;
};

export type EnforcementDashboardProps = {
  report: EnforcementReport;
  onApplyFixes?: () => Promise<void>;
  onIgnoreAll?: () => void;
};

export type RuleEditorProps = {
  rule?: EnforcementRule;
  onSave: (rule: EnforcementRule) => Promise<void>;
  onCancel: () => void;
};
