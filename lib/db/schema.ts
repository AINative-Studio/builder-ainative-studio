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

// Simple ownership mapping for v0 chats
// The actual chat data lives in v0 API, we just track who owns what
export const chat_ownerships = pgTable(
  'chat_ownerships',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    v0_chat_id: varchar('v0_chat_id', { length: 255 }).notNull(), // v0 API chat ID
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Ensure each v0 chat can only be owned by one user
    unique_v0_chat: unique().on(table.v0_chat_id),
  }),
)

export type ChatOwnership = InferSelectModel<typeof chat_ownerships>

// Track anonymous chat creation by IP for rate limiting
export const anonymous_chat_logs = pgTable('anonymous_chat_logs', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  ip_address: varchar('ip_address', { length: 45 }).notNull(), // IPv6 can be up to 45 chars
  v0_chat_id: varchar('v0_chat_id', { length: 255 }).notNull(), // v0 API chat ID
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
