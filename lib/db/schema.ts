import type { InferSelectModel } from 'drizzle-orm'
import {
  pgTable,
  varchar,
  timestamp,
  uuid,
  primaryKey,
  unique,
  text,
  integer,
  boolean,
  jsonb,
  index,
} from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull(),
  password: varchar('hashed_password', { length: 255 }), // Maps to hashed_password column in AINative DB
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type User = InferSelectModel<typeof users>

// Simple ownership mapping for chats
// Tracks which user owns which chat
export const chat_ownerships = pgTable(
  'chat_ownerships',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    chat_id: varchar('chat_id', { length: 255 }).notNull(), // Chat ID from our system
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Ensure each chat can only be owned by one user
    unique_chat: unique().on(table.chat_id),
  }),
)

export type ChatOwnership = InferSelectModel<typeof chat_ownerships>

// Track anonymous chat creation by IP for rate limiting
export const anonymous_chat_logs = pgTable('anonymous_chat_logs', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  ip_address: varchar('ip_address', { length: 45 }).notNull(), // IPv6 can be up to 45 chars
  chat_id: varchar('chat_id', { length: 255 }).notNull(), // Chat ID from our system
  created_at: timestamp('created_at').notNull().defaultNow(),
})

export type AnonymousChatLog = InferSelectModel<typeof anonymous_chat_logs>

// Error logging table for monitoring and alerting
export const error_logs = pgTable(
  'error_logs',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    timestamp: timestamp('timestamp').notNull().defaultNow(),
    level: varchar('level', { length: 20 }).notNull(), // info, warn, error, fatal
    message: text('message').notNull(),
    context: jsonb('context'), // { userId, chatId, path, method, etc }
    stack_trace: text('stack_trace'),
    error_type: varchar('error_type', { length: 100 }), // For grouping errors
    endpoint: varchar('endpoint', { length: 255 }), // API endpoint or route
    user_id: uuid('user_id').references(() => users.id),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for querying recent errors
    timestamp_idx: index('error_logs_timestamp_idx').on(table.timestamp),
    // Index for filtering by error type
    error_type_idx: index('error_logs_error_type_idx').on(table.error_type),
    // Index for filtering by endpoint
    endpoint_idx: index('error_logs_endpoint_idx').on(table.endpoint),
  }),
)

export type ErrorLog = InferSelectModel<typeof error_logs>

// RLHF: Prompt Version Management (US-015)
export const prompt_versions = pgTable(
  'prompt_versions',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    type: varchar('type', { length: 50 }).notNull(), // 'system' | 'enhancement'
    version: varchar('version', { length: 50 }).notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata'), // Additional prompt configuration
    is_active: boolean('is_active').notNull().default(false),
    ab_test_percentage: integer('ab_test_percentage').default(0), // 0-100, for A/B testing
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index on type and is_active for fast active prompt lookup
    type_active_idx: index('prompt_versions_type_active_idx').on(
      table.type,
      table.is_active,
    ),
    // Index on type and version for version queries
    type_version_idx: index('prompt_versions_type_version_idx').on(
      table.type,
      table.version,
    ),
  }),
)

export type PromptVersion = InferSelectModel<typeof prompt_versions>

// RLHF: Generation Logging (US-011)
export const generations = pgTable(
  'generations',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    chat_id: varchar('chat_id', { length: 255 }).notNull(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id),
    prompt: text('prompt').notNull(),
    generated_code: text('generated_code').notNull(),
    prompt_version_id: uuid('prompt_version_id').references(
      () => prompt_versions.id,
    ),
    design_tokens_version_id: uuid('design_tokens_version_id'),
    model: varchar('model', { length: 100 }).notNull(),
    template_used: varchar('template_used', { length: 100 }),
    generation_time_ms: integer('generation_time_ms').notNull(),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Indexes for analytics queries
    prompt_version_idx: index('generations_prompt_version_idx').on(
      table.prompt_version_id,
    ),
    user_id_idx: index('generations_user_id_idx').on(table.user_id),
    created_at_idx: index('generations_created_at_idx').on(table.created_at),
    model_idx: index('generations_model_idx').on(table.model),
    design_tokens_idx: index('generations_design_tokens_idx').on(
      table.design_tokens_version_id,
    ),
  }),
)

export type Generation = InferSelectModel<typeof generations>

// RLHF: User Feedback Collection (US-012)
export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    generation_id: uuid('generation_id')
      .notNull()
      .references(() => generations.id),
    rating: integer('rating').notNull(), // 1-5
    feedback_text: text('feedback_text'),
    was_edited: boolean('was_edited').notNull().default(false),
    iterations: integer('iterations').notNull().default(1),
    edit_changes_summary: jsonb('edit_changes_summary'), // { linesAdded, linesRemoved, componentsChanged, styleChanges }
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index on generation_id for quick feedback lookup
    generation_id_idx: index('feedback_generation_id_idx').on(
      table.generation_id,
    ),
    // Index on rating for quality analytics
    rating_idx: index('feedback_rating_idx').on(table.rating),
    // Index on created_at for time-based queries
    created_at_idx: index('feedback_created_at_idx').on(table.created_at),
  }),
)

export type Feedback = InferSelectModel<typeof feedback>

// US-002: Chat History Persistence
// Chats table stores chat metadata
export const chats = pgTable(
  'chats',
  {
    id: varchar('id', { length: 255 }).primaryKey().notNull(), // Using nanoid from application
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }), // Chat title/name
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for user's chats lookup
    user_id_idx: index('chats_user_id_idx').on(table.user_id),
    // Index for sorting by creation time
    created_at_idx: index('chats_created_at_idx').on(table.created_at),
  })
)

export type Chat = InferSelectModel<typeof chats>

// Messages table stores individual chat messages
export const messages = pgTable(
  'messages',
  {
    id: varchar('id', { length: 255 }).primaryKey().notNull(), // Using nanoid from application
    chat_id: varchar('chat_id', { length: 255 })
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).notNull(), // 'user' | 'assistant' | 'system'
    content: text('content').notNull(),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for fetching all messages in a chat
    chat_id_idx: index('messages_chat_id_idx').on(table.chat_id),
    // Index for chronological ordering
    created_at_idx: index('messages_created_at_idx').on(table.created_at),
    // Composite index for efficient chat message retrieval
    chat_created_idx: index('messages_chat_created_idx').on(
      table.chat_id,
      table.created_at
    ),
  })
)

export type Message = InferSelectModel<typeof messages>

// Sessions table for Redis-backed session management (US-010)
export const sessions = pgTable(
  'sessions',
  {
    id: varchar('id', { length: 255 }).primaryKey().notNull(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires_at: timestamp('expires_at').notNull(),
    created_at: timestamp('created_at').notNull().defaultNow(),
    last_activity: timestamp('last_activity').notNull().defaultNow(),
  },
  (table) => ({
    // Index for user's sessions lookup
    user_id_idx: index('sessions_user_id_idx').on(table.user_id),
    // Index for expiration cleanup
    expires_at_idx: index('sessions_expires_at_idx').on(table.expires_at),
  })
)

export type Session = InferSelectModel<typeof sessions>

// Design Tokens table for MCP Integration (Epic 3)
export const design_tokens = pgTable(
  'design_tokens',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    tokens: jsonb('tokens').notNull(), // { light: {...}, dark: {...} }
    version: varchar('version', { length: 20 }).notNull(), // semver format
    is_active: boolean('is_active').notNull().default(false),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for user's design tokens lookup
    user_id_idx: index('design_tokens_user_id_idx').on(table.user_id),
    // Index for version queries
    version_idx: index('design_tokens_version_idx').on(table.version),
    // Unique constraint on user, name, and version
    unique_user_name_version: unique().on(table.user_id, table.name, table.version),
  })
)

export type DesignToken = InferSelectModel<typeof design_tokens>

// Few-Shot Examples for Enhanced Prompt Engineering (Epic 4, US-028)
export const few_shot_examples = pgTable(
  'few_shot_examples',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    category: varchar('category', { length: 50 }).notNull(), // 'dashboard', 'form', 'ecommerce', 'landing', 'blog', 'admin'
    prompt: text('prompt').notNull(),
    good_output: text('good_output').notNull(),
    explanation: text('explanation').notNull(),
    tags: jsonb('tags').notNull().$type<string[]>(), // Array of tags for filtering
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for category-based filtering
    category_idx: index('few_shot_examples_category_idx').on(table.category),
  })
)

export type FewShotExample = InferSelectModel<typeof few_shot_examples>

// Templates for Epic 5: Template System (US-035)
export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    category: varchar('category', { length: 50 }).notNull(), // 'dashboard', 'ecommerce', 'landing', 'admin', 'blog'
    description: text('description').notNull(),
    code: text('code').notNull(), // React component code with placeholders
    preview_image_url: text('preview_image_url'),
    tags: jsonb('tags').notNull().$type<string[]>(), // Array of tags for searching
    metadata: jsonb('metadata').notNull().$type<{
      placeholders: string[]
      components_used: string[]
      complexity: 'simple' | 'medium' | 'advanced'
    }>(),
    is_active: boolean('is_active').notNull().default(true),
    usage_count: integer('usage_count').notNull().default(0),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for category-based filtering
    category_idx: index('templates_category_idx').on(table.category),
    // Index for usage analytics
    usage_count_idx: index('templates_usage_count_idx').on(table.usage_count),
    // Index for active templates
    is_active_idx: index('templates_is_active_idx').on(table.is_active),
  })
)

export type Template = InferSelectModel<typeof templates>

// Template Submissions for user-contributed templates (US-040)
export const template_submissions = pgTable(
  'template_submissions',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    user_id: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    template_data: jsonb('template_data').notNull().$type<{
      name: string
      category: string
      description: string
      code: string
      tags: string[]
      metadata: {
        placeholders: string[]
        components_used: string[]
        complexity: 'simple' | 'medium' | 'advanced'
      }
    }>(),
    status: varchar('status', { length: 20 }).notNull().default('pending'), // 'pending', 'approved', 'rejected'
    admin_notes: text('admin_notes'),
    submitted_at: timestamp('submitted_at').notNull().defaultNow(),
    reviewed_at: timestamp('reviewed_at'),
    reviewed_by: uuid('reviewed_by').references(() => users.id),
  },
  (table) => ({
    // Index for filtering by status
    status_idx: index('template_submissions_status_idx').on(table.status),
    // Index for user submissions lookup
    user_id_idx: index('template_submissions_user_id_idx').on(table.user_id),
    // Index for sorting by submission time
    submitted_at_idx: index('template_submissions_submitted_at_idx').on(table.submitted_at),
  })
)

export type TemplateSubmission = InferSelectModel<typeof template_submissions>

// Epic 9: Export & Multi-Platform Deployment

// Deployments table tracks all deployment attempts across platforms (US-067, US-068, US-069, US-070)
export const deployments = pgTable(
  'deployments',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    generation_id: uuid('generation_id').references(() => generations.id, { onDelete: 'set null' }),
    platform: varchar('platform', { length: 50 }).notNull(), // 'vercel' | 'netlify' | 'railway' | 'ainative-cloud'
    url: text('url'), // Deployment URL once available
    status: varchar('status', { length: 20 }).notNull().default('pending'), // 'pending' | 'building' | 'ready' | 'error'
    deployment_id: varchar('deployment_id', { length: 255 }), // External platform deployment ID
    metadata: jsonb('metadata').$type<{
      projectName?: string
      error?: string
      buildLogs?: string[]
      selectedProvider?: string // For ainative-cloud: which provider was auto-selected
      [key: string]: any
    }>(), // Platform-specific data
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for user's deployments lookup
    user_id_idx: index('deployments_user_id_idx').on(table.user_id),
    // Index for status-based filtering
    status_idx: index('deployments_status_idx').on(table.status),
    // Index for platform analytics
    platform_idx: index('deployments_platform_idx').on(table.platform),
    // Index for generation tracking
    generation_id_idx: index('deployments_generation_id_idx').on(table.generation_id),
    // Index for sorting by creation time
    created_at_idx: index('deployments_created_at_idx').on(table.created_at),
  })
)

export type Deployment = InferSelectModel<typeof deployments>

// Deployment Credentials table stores encrypted API tokens per user per platform (US-071)
export const deployment_credentials = pgTable(
  'deployment_credentials',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: varchar('platform', { length: 50 }).notNull(), // 'vercel' | 'netlify' | 'railway' | 'ainative-cloud'
    encrypted_token: text('encrypted_token').notNull(), // AES-256-GCM encrypted token
    iv: varchar('iv', { length: 32 }).notNull(), // Initialization vector for AES-256-GCM
    auth_tag: varchar('auth_tag', { length: 32 }).notNull(), // Authentication tag for AES-256-GCM
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for user's credentials lookup
    user_id_idx: index('deployment_credentials_user_id_idx').on(table.user_id),
    // Unique constraint: one credential per user per platform
    unique_user_platform: unique().on(table.user_id, table.platform),
  })
)

export type DeploymentCredential = InferSelectModel<typeof deployment_credentials>

// Rule Enforcement Framework (Issue #18)

// Rule Sets: Collections of rules that can be applied together
export const rule_sets = pgTable(
  'rule_sets',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description').notNull(),
    is_built_in: boolean('is_built_in').notNull().default(false),
    team_id: uuid('team_id'), // For team-specific rule sets
    version: varchar('version', { length: 20 }).notNull(), // semver format
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for built-in rule sets lookup
    is_built_in_idx: index('rule_sets_is_built_in_idx').on(table.is_built_in),
    // Index for team rule sets lookup
    team_id_idx: index('rule_sets_team_id_idx').on(table.team_id),
  })
)

export type RuleSet = InferSelectModel<typeof rule_sets>

// Enforcement Rules: Individual validation rules
export const enforcement_rules = pgTable(
  'enforcement_rules',
  {
    id: varchar('id', { length: 255 }).primaryKey().notNull(), // e.g., 'git/no-ai-attribution'
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description').notNull(),
    level: varchar('level', { length: 20 }).notNull().default('error'), // 'error' | 'warning' | 'info'
    category: varchar('category', { length: 50 }).notNull(), // 'git' | 'file-placement' | 'testing' | 'security' | etc.
    contexts: jsonb('contexts').notNull().$type<string[]>(), // ['commit', 'file-create', etc.]
    enabled: boolean('enabled').notNull().default(true),
    tags: jsonb('tags').notNull().$type<string[]>(), // Array of tags for filtering
    rule_set_id: uuid('rule_set_id').references(() => rule_sets.id, { onDelete: 'cascade' }),
    docs_url: text('docs_url'), // Link to rule documentation
    examples: jsonb('examples').$type<{
      invalid: string
      valid: string
      explanation: string
    }[]>(), // Examples of violations
    options: jsonb('options').$type<Record<string, any>>(), // Rule-specific configuration
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for category-based filtering
    category_idx: index('enforcement_rules_category_idx').on(table.category),
    // Index for enabled rules lookup
    enabled_idx: index('enforcement_rules_enabled_idx').on(table.enabled),
    // Index for rule set lookup
    rule_set_id_idx: index('enforcement_rules_rule_set_id_idx').on(table.rule_set_id),
    // Index for level filtering
    level_idx: index('enforcement_rules_level_idx').on(table.level),
  })
)

export type EnforcementRule = InferSelectModel<typeof enforcement_rules>

// Rule Violations: Historical record of violations
export const rule_violations = pgTable(
  'rule_violations',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    rule_id: varchar('rule_id', { length: 255 })
      .notNull()
      .references(() => enforcement_rules.id, { onDelete: 'cascade' }),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    project_id: varchar('project_id', { length: 255 }), // For multi-project support
    action_type: varchar('action_type', { length: 50 }).notNull(), // 'commit' | 'file-create' | etc.
    action_data: jsonb('action_data').notNull().$type<{
      commitMessage?: string
      branch?: string
      files?: string[]
      filePath?: string
      fileContent?: string
      prTitle?: string
      prDescription?: string
      metadata?: Record<string, any>
    }>(), // The action that caused the violation
    violation_message: text('violation_message').notNull(),
    violation_details: text('violation_details'),
    location: jsonb('location').$type<{
      file?: string
      line?: number
      column?: number
      snippet?: string
    }>(), // Where the violation occurred
    suggestion: text('suggestion'), // How to fix it
    auto_fixable: boolean('auto_fixable').notNull().default(false),
    fixed: boolean('fixed').notNull().default(false),
    fix_method: varchar('fix_method', { length: 20 }), // 'auto' | 'manual' | 'ignored'
    time_to_fix_ms: integer('time_to_fix_ms'), // How long it took to fix
    created_at: timestamp('created_at').notNull().defaultNow(),
    fixed_at: timestamp('fixed_at'),
  },
  (table) => ({
    // Index for rule lookup
    rule_id_idx: index('rule_violations_rule_id_idx').on(table.rule_id),
    // Index for user violations lookup
    user_id_idx: index('rule_violations_user_id_idx').on(table.user_id),
    // Index for project violations lookup
    project_id_idx: index('rule_violations_project_id_idx').on(table.project_id),
    // Index for action type filtering
    action_type_idx: index('rule_violations_action_type_idx').on(table.action_type),
    // Index for fixed status
    fixed_idx: index('rule_violations_fixed_idx').on(table.fixed),
    // Index for auto-fixable violations
    auto_fixable_idx: index('rule_violations_auto_fixable_idx').on(table.auto_fixable),
    // Index for sorting by creation time
    created_at_idx: index('rule_violations_created_at_idx').on(table.created_at),
  })
)

export type RuleViolation = InferSelectModel<typeof rule_violations>

// Enforcement Reports: Summary of validation results
export const enforcement_reports = pgTable(
  'enforcement_reports',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    project_id: varchar('project_id', { length: 255 }), // For multi-project support
    action_type: varchar('action_type', { length: 50 }).notNull(),
    action_data: jsonb('action_data').notNull().$type<Record<string, any>>(),
    passed: boolean('passed').notNull(),
    error_count: integer('error_count').notNull().default(0),
    warning_count: integer('warning_count').notNull().default(0),
    info_count: integer('info_count').notNull().default(0),
    total_duration_ms: integer('total_duration_ms').notNull(),
    can_auto_fix: boolean('can_auto_fix').notNull().default(false),
    suggestions: jsonb('suggestions').$type<string[]>(),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for user reports lookup
    user_id_idx: index('enforcement_reports_user_id_idx').on(table.user_id),
    // Index for project reports lookup
    project_id_idx: index('enforcement_reports_project_id_idx').on(table.project_id),
    // Index for passed/failed filtering
    passed_idx: index('enforcement_reports_passed_idx').on(table.passed),
    // Index for sorting by creation time
    created_at_idx: index('enforcement_reports_created_at_idx').on(table.created_at),
  })
)

export type EnforcementReport = InferSelectModel<typeof enforcement_reports>

// Project Enforcement Configuration
export const enforcement_configs = pgTable(
  'enforcement_configs',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    project_id: varchar('project_id', { length: 255 }).notNull(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rule_set_ids: jsonb('rule_set_ids').notNull().$type<string[]>(), // Active rule sets
    rule_configs: jsonb('rule_configs').notNull().$type<Array<{
      ruleId: string
      level?: string
      enabled?: boolean
      options?: Record<string, any>
    }>>(), // Rule-specific overrides
    settings: jsonb('settings').notNull().$type<{
      autoFix: boolean
      strictMode: boolean
      continueOnError: boolean
      maxViolations?: number
    }>(), // Global enforcement settings
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for project config lookup
    project_id_idx: index('enforcement_configs_project_id_idx').on(table.project_id),
    // Index for user configs lookup
    user_id_idx: index('enforcement_configs_user_id_idx').on(table.user_id),
    // Unique constraint: one config per project per user
    unique_project_user: unique().on(table.project_id, table.user_id),
  })
)

export type EnforcementConfig = InferSelectModel<typeof enforcement_configs>

// Agent Skill System (Issue #16)

// Skills: Modular, progressive-disclosure skill definitions
export const skills = pgTable(
  'skills',
  {
    id: varchar('id', { length: 255 }).primaryKey().notNull(), // e.g., 'mandatory-tdd', 'git-workflow'
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description').notNull(), // ~100 words shown in autocomplete and skill browser
    version: varchar('version', { length: 20 }).notNull(), // semver format
    author_id: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    author_name: varchar('author_name', { length: 255 }).notNull(),
    author_email: varchar('author_email', { length: 255 }),
    tags: jsonb('tags').notNull().$type<string[]>(), // Array of tags for categorization and search
    trigger_patterns: jsonb('trigger_patterns').$type<string[]>(), // When this skill should auto-load
    dependencies: jsonb('dependencies').$type<string[]>(), // Other skills this one depends on
    token_cost_metadata: integer('token_cost_metadata').notNull().default(100), // Cost to load metadata only
    token_cost_full: integer('token_cost_full').notNull().default(2000), // Cost to load full skill content
    compatibility: jsonb('compatibility').$type<{
      frameworks?: string[]
      languages?: string[]
      minVersion?: string
    }>(), // Compatibility requirements
    content: text('content').notNull(), // Full skill content (markdown)
    references: jsonb('references').$type<Array<{
      name: string
      path: string
      type: 'markdown' | 'code' | 'url' | 'example'
      description?: string
    }>>(), // Reference documents
    examples: jsonb('examples').$type<Array<{
      title: string
      content: string
      language?: string
      description?: string
    }>>(), // Code examples
    validation_rules: jsonb('validation_rules').$type<string[]>(), // Validation rules the skill enforces
    commands: jsonb('commands').$type<string[]>(), // Commands this skill provides
    is_built_in: boolean('is_built_in').notNull().default(false),
    is_active: boolean('is_active').notNull().default(true),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for tag-based search
    tags_idx: index('skills_tags_idx').using('gin', table.tags),
    // Index for author lookup
    author_id_idx: index('skills_author_id_idx').on(table.author_id),
    // Index for built-in skills
    is_built_in_idx: index('skills_is_built_in_idx').on(table.is_built_in),
    // Index for active skills
    is_active_idx: index('skills_is_active_idx').on(table.is_active),
    // Index for version queries
    version_idx: index('skills_version_idx').on(table.version),
  })
)

export type Skill = InferSelectModel<typeof skills>

// Skill Collections: Groupings of related skills
export const skill_collections = pgTable(
  'skill_collections',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description').notNull(),
    skill_ids: jsonb('skill_ids').notNull().$type<string[]>(), // Array of skill IDs
    is_built_in: boolean('is_built_in').notNull().default(false),
    is_team: boolean('is_team').notNull().default(false),
    team_id: uuid('team_id'), // For team-specific collections
    user_id: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }), // For personal collections
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for built-in collections
    is_built_in_idx: index('skill_collections_is_built_in_idx').on(table.is_built_in),
    // Index for team collections
    team_id_idx: index('skill_collections_team_id_idx').on(table.team_id),
    // Index for user collections
    user_id_idx: index('skill_collections_user_id_idx').on(table.user_id),
  })
)

export type SkillCollection = InferSelectModel<typeof skill_collections>

// Skill Usage: Track skill loading and usage statistics
export const skill_usage = pgTable(
  'skill_usage',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    skill_id: varchar('skill_id', { length: 255 })
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    session_id: varchar('session_id', { length: 255 }), // Chat session ID
    project_id: varchar('project_id', { length: 255 }), // For multi-project support
    load_type: varchar('load_type', { length: 20 }).notNull(), // 'manual' | 'auto' | 'recommended'
    trigger_pattern: varchar('trigger_pattern', { length: 255 }), // Pattern that triggered auto-load
    context: jsonb('context').$type<{
      currentFile?: string
      gitBranch?: string
      hasUncommittedChanges?: boolean
      recentMessages?: string[]
    }>(), // Context at time of loading
    load_time_ms: integer('load_time_ms').notNull(), // Time to load the skill
    metadata_loaded: boolean('metadata_loaded').notNull().default(true),
    content_loaded: boolean('content_loaded').notNull().default(false),
    references_loaded: boolean('references_loaded').notNull().default(false),
    tokens_used: integer('tokens_used').notNull(), // Actual tokens used
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for skill usage analytics
    skill_id_idx: index('skill_usage_skill_id_idx').on(table.skill_id),
    // Index for user usage lookup
    user_id_idx: index('skill_usage_user_id_idx').on(table.user_id),
    // Index for load type analytics
    load_type_idx: index('skill_usage_load_type_idx').on(table.load_type),
    // Index for session tracking
    session_id_idx: index('skill_usage_session_id_idx').on(table.session_id),
    // Index for sorting by creation time
    created_at_idx: index('skill_usage_created_at_idx').on(table.created_at),
  })
)

export type SkillUsage = InferSelectModel<typeof skill_usage>

// Skill Ratings: User feedback on skills
export const skill_ratings = pgTable(
  'skill_ratings',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    skill_id: varchar('skill_id', { length: 255 })
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(), // 1-5
    feedback_text: text('feedback_text'),
    helpful: boolean('helpful').notNull().default(true),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for skill ratings lookup
    skill_id_idx: index('skill_ratings_skill_id_idx').on(table.skill_id),
    // Index for user ratings lookup
    user_id_idx: index('skill_ratings_user_id_idx').on(table.user_id),
    // Index for rating analytics
    rating_idx: index('skill_ratings_rating_idx').on(table.rating),
    // Unique constraint: one rating per user per skill
    unique_user_skill: unique().on(table.user_id, table.skill_id),
  })
)

export type SkillRating = InferSelectModel<typeof skill_ratings>

// Context Budget Manager (Issue #20)

// Budget Tracking: Track token usage across sessions
export const budget_tracking = pgTable(
  'budget_tracking',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    session_id: varchar('session_id', { length: 255 }).notNull(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    total_tokens: integer('total_tokens').notNull().default(128000), // Default context window
    used_tokens: integer('used_tokens').notNull().default(0),
    remaining_tokens: integer('remaining_tokens').notNull().default(128000),
    usage_percentage: integer('usage_percentage').notNull().default(0), // 0-100
    is_warning: boolean('is_warning').notNull().default(false), // >80%
    is_critical: boolean('is_critical').notNull().default(false), // >95%
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for session lookup
    session_id_idx: index('budget_tracking_session_id_idx').on(table.session_id),
    // Index for user budget lookup
    user_id_idx: index('budget_tracking_user_id_idx').on(table.user_id),
    // Index for warning state
    is_warning_idx: index('budget_tracking_is_warning_idx').on(table.is_warning),
    // Index for critical state
    is_critical_idx: index('budget_tracking_is_critical_idx').on(table.is_critical),
    // Unique constraint: one budget per session
    unique_session: unique().on(table.session_id),
  })
)

export type BudgetTracking = InferSelectModel<typeof budget_tracking>

// Context Items: Track individual context items and their token costs
export const context_items = pgTable(
  'context_items',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    session_id: varchar('session_id', { length: 255 }).notNull(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(), // 'skill' | 'file' | 'message' | 'tool' | 'baseline' | 'history'
    name: varchar('name', { length: 255 }).notNull(),
    token_cost: integer('token_cost').notNull(),
    priority: varchar('priority', { length: 20 }).notNull(), // 'critical' | 'high' | 'medium' | 'low'
    status: varchar('status', { length: 20 }).notNull().default('loaded'), // 'loaded' | 'unloaded' | 'pending' | 'failed'
    last_accessed_at: timestamp('last_accessed_at'),
    access_count: integer('access_count').notNull().default(0),
    metadata: jsonb('metadata').$type<{
      path?: string
      skillId?: string
      messageId?: string
      summary?: string
      compressed?: boolean
      originalCost?: number
    }>(),
    loaded_at: timestamp('loaded_at'),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for session items lookup
    session_id_idx: index('context_items_session_id_idx').on(table.session_id),
    // Index for user items lookup
    user_id_idx: index('context_items_user_id_idx').on(table.user_id),
    // Index for type filtering
    type_idx: index('context_items_type_idx').on(table.type),
    // Index for status filtering
    status_idx: index('context_items_status_idx').on(table.status),
    // Index for priority filtering
    priority_idx: index('context_items_priority_idx').on(table.priority),
    // Index for last accessed (for auto-unload)
    last_accessed_idx: index('context_items_last_accessed_idx').on(table.last_accessed_at),
  })
)

export type ContextItemRecord = InferSelectModel<typeof context_items>

// Budget Events: Historical record of budget changes
export const budget_events = pgTable(
  'budget_events',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    session_id: varchar('session_id', { length: 255 }).notNull(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    event_type: varchar('event_type', { length: 50 }).notNull(), // 'load' | 'unload' | 'threshold_reached' | 'optimization_applied'
    item_id: uuid('item_id').references(() => context_items.id, { onDelete: 'set null' }),
    token_delta: integer('token_delta').notNull(), // Positive for load, negative for unload
    budget_snapshot: jsonb('budget_snapshot').notNull().$type<{
      total: number
      used: number
      remaining: number
      usagePercentage: number
    }>(),
    metadata: jsonb('metadata').$type<Record<string, any>>(),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for session events lookup
    session_id_idx: index('budget_events_session_id_idx').on(table.session_id),
    // Index for user events lookup
    user_id_idx: index('budget_events_user_id_idx').on(table.user_id),
    // Index for event type filtering
    event_type_idx: index('budget_events_event_type_idx').on(table.event_type),
    // Index for sorting by creation time
    created_at_idx: index('budget_events_created_at_idx').on(table.created_at),
  })
)

export type BudgetEvent = InferSelectModel<typeof budget_events>

// Budget Configurations: User preferences for budget management
export const budget_configurations = pgTable(
  'budget_configurations',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    total_tokens: integer('total_tokens').notNull().default(128000),
    warning_threshold: integer('warning_threshold').notNull().default(80), // 80%
    critical_threshold: integer('critical_threshold').notNull().default(95), // 95%
    auto_unload_enabled: boolean('auto_unload_enabled').notNull().default(true),
    auto_unload_min_access_count: integer('auto_unload_min_access_count').notNull().default(1),
    auto_unload_min_time_ms: integer('auto_unload_min_time_ms').notNull().default(300000), // 5 minutes
    compression_enabled: boolean('compression_enabled').notNull().default(true),
    auto_compress: boolean('auto_compress').notNull().default(false),
    compression_threshold: integer('compression_threshold').notNull().default(2000), // Tokens
    category_preferences: jsonb('category_preferences').$type<{
      [key: string]: {
        maxPercentage?: number
        priority?: number
      }
    }>(),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for user config lookup
    user_id_idx: index('budget_configurations_user_id_idx').on(table.user_id),
    // Unique constraint: one config per user
    unique_user: unique().on(table.user_id),
  })
)

export type BudgetConfiguration = InferSelectModel<typeof budget_configurations>

// Command Palette System (Issue #17)

// Agent Commands: Cmd+K style command definitions
export const agent_commands = pgTable(
  'agent_commands',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description').notNull(),
    category: varchar('category', { length: 50 }).notNull(), // 'development' | 'testing' | 'deployment' | etc.
    icon: varchar('icon', { length: 50 }), // lucide-react icon name
    tags: jsonb('tags').notNull().$type<string[]>(), // Array of tags for search

    // Authorship
    author_id: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    author_name: varchar('author_name', { length: 255 }).notNull(),

    // Command definition
    template: text('template').notNull(), // Template prompt with {{variables}}
    variables: jsonb('variables').notNull().$type<Array<{
      name: string
      label: string
      description?: string
      type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect' | 'file' | 'url'
      required: boolean
      defaultValue?: any
      options?: Array<{ label: string; value: string; description?: string }>
      validation?: string
      validationMessage?: string
      placeholder?: string
    }>>(),

    // Skills and rules
    required_skills: jsonb('required_skills').notNull().$type<string[]>(), // Skill IDs
    validation_rules: jsonb('validation_rules').$type<string[]>(), // Rule IDs

    // Pre-conditions
    pre_conditions: jsonb('pre_conditions').notNull().$type<Array<{
      id: string
      type: 'file_exists' | 'env_var' | 'tool_available' | 'git_status' | 'custom'
      description: string
      config: Record<string, any>
      blocking: boolean
      errorMessage?: string
    }>>(),

    // Execution workflow
    checkpoints: jsonb('checkpoints').notNull().$type<Array<{
      id: string
      title: string
      description?: string
      order: number
      type: 'info' | 'action' | 'validation' | 'evidence'
      requiresConfirmation?: boolean
      validationRule?: string
      evidenceTypes?: Array<'screenshot' | 'file' | 'log' | 'link'>
    }>>(),

    // Output specification
    output: jsonb('output').notNull().$type<{
      type: 'chat' | 'file' | 'pr' | 'deployment' | 'report'
      config?: Record<string, any>
      successCriteria?: string[]
    }>(),

    // Metadata
    version: varchar('version', { length: 20 }).notNull().default('1.0.0'), // semver
    is_built_in: boolean('is_built_in').notNull().default(false),
    is_team: boolean('is_team').notNull().default(false),
    team_id: uuid('team_id'), // For team commands
    is_active: boolean('is_active').notNull().default(true),

    // Usage statistics
    usage_count: integer('usage_count').notNull().default(0),
    avg_execution_time_ms: integer('avg_execution_time_ms'),
    success_rate: integer('success_rate'), // 0-100

    // Settings
    shortcut: varchar('shortcut', { length: 50 }), // Keyboard shortcut
    estimated_token_cost: integer('estimated_token_cost'),

    // Timestamps
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for category filtering
    category_idx: index('agent_commands_category_idx').on(table.category),
    // Index for author lookup
    author_id_idx: index('agent_commands_author_id_idx').on(table.author_id),
    // Index for built-in commands
    is_built_in_idx: index('agent_commands_is_built_in_idx').on(table.is_built_in),
    // Index for team commands
    is_team_idx: index('agent_commands_is_team_idx').on(table.is_team),
    team_id_idx: index('agent_commands_team_id_idx').on(table.team_id),
    // Index for active commands
    is_active_idx: index('agent_commands_is_active_idx').on(table.is_active),
    // Index for usage analytics
    usage_count_idx: index('agent_commands_usage_count_idx').on(table.usage_count),
  })
)

export type AgentCommandRecord = InferSelectModel<typeof agent_commands>

// Command Favorites: User's favorited commands
export const command_favorites = pgTable(
  'command_favorites',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    command_id: uuid('command_id')
      .notNull()
      .references(() => agent_commands.id, { onDelete: 'cascade' }),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for user favorites lookup
    user_id_idx: index('command_favorites_user_id_idx').on(table.user_id),
    // Index for command favorites count
    command_id_idx: index('command_favorites_command_id_idx').on(table.command_id),
    // Unique constraint: one favorite per user per command
    unique_user_command: unique().on(table.user_id, table.command_id),
  })
)

export type CommandFavorite = InferSelectModel<typeof command_favorites>

// Command Executions: Historical record of command executions
export const command_executions = pgTable(
  'command_executions',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    command_id: uuid('command_id')
      .notNull()
      .references(() => agent_commands.id, { onDelete: 'cascade' }),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chat_id: varchar('chat_id', { length: 255 }).references(() => chats.id, { onDelete: 'set null' }),

    // Execution context
    variable_values: jsonb('variable_values').notNull().$type<Record<string, any>>(),
    git_context: jsonb('git_context').$type<{
      branch: string
      hasUncommittedChanges: boolean
      lastCommitHash?: string
    }>(),

    // Execution state
    status: varchar('status', { length: 20 }).notNull().default('pending'), // 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    current_checkpoint_index: integer('current_checkpoint_index').notNull().default(0),

    // Checkpoint states
    checkpoint_states: jsonb('checkpoint_states').notNull().$type<Array<{
      checkpointId: string
      status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
      startedAt?: Date
      completedAt?: Date
      error?: string
      evidence?: Array<{
        type: 'screenshot' | 'file' | 'log' | 'link'
        data: string
        timestamp: Date
      }>
      notes?: string
    }>>(),

    // Pre-condition results
    pre_condition_results: jsonb('pre_condition_results').notNull().$type<Array<{
      conditionId: string
      passed: boolean
      message?: string
    }>>(),

    // Output
    output: jsonb('output').$type<{
      type: string
      data: any
      url?: string
    }>(),

    // Execution logs
    logs: jsonb('logs').notNull().$type<Array<{
      timestamp: Date
      level: 'info' | 'warning' | 'error'
      message: string
      data?: any
    }>>(),

    // Metrics
    execution_time_ms: integer('execution_time_ms'),
    token_usage: integer('token_usage'),
    success: boolean('success').notNull().default(false),

    // Error details
    error: jsonb('error').$type<{
      message: string
      stack?: string
      checkpoint?: string
    }>(),

    // Timestamps
    started_at: timestamp('started_at').notNull().defaultNow(),
    completed_at: timestamp('completed_at'),
  },
  (table) => ({
    // Index for command executions lookup
    command_id_idx: index('command_executions_command_id_idx').on(table.command_id),
    // Index for user executions lookup
    user_id_idx: index('command_executions_user_id_idx').on(table.user_id),
    // Index for chat executions lookup
    chat_id_idx: index('command_executions_chat_id_idx').on(table.chat_id),
    // Index for status filtering
    status_idx: index('command_executions_status_idx').on(table.status),
    // Index for success/failure filtering
    success_idx: index('command_executions_success_idx').on(table.success),
    // Index for sorting by start time
    started_at_idx: index('command_executions_started_at_idx').on(table.started_at),
  })
)

export type CommandExecution = InferSelectModel<typeof command_executions>

// Command Templates: Pre-built templates for common workflows
export const command_templates = pgTable(
  'command_templates',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description').notNull(),
    category: varchar('category', { length: 50 }).notNull(),
    preview_image: text('preview_image'),
    template_data: jsonb('template_data').notNull().$type<Partial<{
      name: string
      description: string
      category: string
      template: string
      variables: any[]
      requiredSkills: string[]
      preConditions: any[]
      checkpoints: any[]
      output: any
      validationRules?: string[]
    }>>(),
    is_built_in: boolean('is_built_in').notNull().default(false),
    usage_count: integer('usage_count').notNull().default(0),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for category filtering
    category_idx: index('command_templates_category_idx').on(table.category),
    // Index for built-in templates
    is_built_in_idx: index('command_templates_is_built_in_idx').on(table.is_built_in),
    // Index for usage analytics
    usage_count_idx: index('command_templates_usage_count_idx').on(table.usage_count),
  })
)

export type CommandTemplateRecord = InferSelectModel<typeof command_templates>

// Evidence Collection System (Issue #19)

// Evidence: Captures automated proof of test runs, builds, deployments
export const evidence = pgTable(
  'evidence',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(), // 'test-run' | 'build' | 'coverage' | 'deployment' | 'screenshot' | etc.
    status: varchar('status', { length: 20 }).notNull(), // 'success' | 'failure' | 'warning' | 'pending' | 'skipped'
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    command: text('command'), // The command that was executed
    stdout: text('stdout'), // Standard output
    stderr: text('stderr'), // Standard error
    metadata: jsonb('metadata').notNull().$type<{
      // Test metadata
      testsPassed?: number
      testsFailed?: number
      testsSkipped?: number
      totalTests?: number
      testDuration?: number
      // Coverage metadata
      coveragePercent?: number
      linesCovered?: number
      linesTotal?: number
      branchesCovered?: number
      branchesTotal?: number
      functionsCovered?: number
      functionsTotal?: number
      statementsCovered?: number
      statementsTotal?: number
      // Build metadata
      buildSuccess?: boolean
      buildErrors?: number
      buildWarnings?: number
      buildDuration?: number
      bundleSize?: number
      chunks?: number
      // Deployment metadata
      deploymentUrl?: string
      deploymentId?: string
      deploymentPlatform?: string
      deploymentStatus?: string
      // Command execution
      commandExecuted?: string
      exitCode?: number
      executionDuration?: number
      workingDirectory?: string
      // General
      framework?: string
      environment?: string
      gitCommit?: string
      gitBranch?: string
      nodeVersion?: string
      pythonVersion?: string
      [key: string]: any
    }>(),
    project_id: varchar('project_id', { length: 255 }), // For multi-project support
    git_commit: varchar('git_commit', { length: 255 }), // Git commit SHA
    git_branch: varchar('git_branch', { length: 255 }), // Git branch name
    parent_evidence_id: uuid('parent_evidence_id').references(() => evidence.id), // Link related evidence
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for user evidence lookup
    user_id_idx: index('evidence_user_id_idx').on(table.user_id),
    // Index for type filtering
    type_idx: index('evidence_type_idx').on(table.type),
    // Index for status filtering
    status_idx: index('evidence_status_idx').on(table.status),
    // Index for project filtering
    project_id_idx: index('evidence_project_id_idx').on(table.project_id),
    // Index for git commit lookup
    git_commit_idx: index('evidence_git_commit_idx').on(table.git_commit),
    // Index for git branch filtering
    git_branch_idx: index('evidence_git_branch_idx').on(table.git_branch),
    // Index for parent evidence lookup
    parent_evidence_id_idx: index('evidence_parent_evidence_id_idx').on(table.parent_evidence_id),
    // Index for sorting by creation time
    created_at_idx: index('evidence_created_at_idx').on(table.created_at),
  })
)

export type Evidence = InferSelectModel<typeof evidence>

// Artifacts: Files attached to evidence (logs, coverage reports, screenshots)
export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    evidence_id: uuid('evidence_id')
      .notNull()
      .references(() => evidence.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    type: varchar('type', { length: 50 }).notNull(), // 'log' | 'coverage-report' | 'screenshot' | 'build-output' | 'json' | 'html'
    mime_type: varchar('mime_type', { length: 100 }).notNull(),
    size: integer('size').notNull(), // Size in bytes
    storage_path: text('storage_path').notNull(), // Path in storage system
    url: text('url'), // Public URL if available
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for evidence artifacts lookup
    evidence_id_idx: index('artifacts_evidence_id_idx').on(table.evidence_id),
    // Index for type filtering
    type_idx: index('artifacts_type_idx').on(table.type),
  })
)

export type Artifact = InferSelectModel<typeof artifacts>

// Evidence Verifications: Track verification of agent claims against evidence
export const evidence_verifications = pgTable(
  'evidence_verifications',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    evidence_id: uuid('evidence_id')
      .notNull()
      .references(() => evidence.id, { onDelete: 'cascade' }),
    claim: text('claim').notNull(), // The claim being verified
    verified: boolean('verified').notNull(), // Whether the claim matches evidence
    verification_method: varchar('verification_method', { length: 100 }).notNull(), // 'auto' | 'manual'
    verifier: varchar('verifier', { length: 255 }), // Who/what verified (user or system)
    notes: text('notes'), // Additional verification notes
    verification_date: timestamp('verification_date').notNull().defaultNow(),
  },
  (table) => ({
    // Index for evidence verifications lookup
    evidence_id_idx: index('evidence_verifications_evidence_id_idx').on(table.evidence_id),
    // Index for verified status
    verified_idx: index('evidence_verifications_verified_idx').on(table.verified),
  })
)

export type EvidenceVerification = InferSelectModel<typeof evidence_verifications>
