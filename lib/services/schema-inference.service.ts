/**
 * Schema Inference Service (Issue #36)
 *
 * Turns a natural-language app description into a concrete backend data model
 * (tables + typed columns + relationships) so the builder can auto-provision a
 * ZeroDB backend alongside the generated UI.
 *
 * This module is intentionally PURE (no network, no DB) so the inference logic
 * is deterministic and unit-testable. Provisioning against ZeroDB lives in
 * `fullstack-generator.service.ts`, which consumes the model produced here.
 *
 * Design goals:
 * - Deterministic: same prompt -> same schema (no LLM randomness in this layer).
 * - Safe: table/column names are always normalized to snake_case identifiers.
 * - Sensible defaults: every table gets id/created_at/updated_at + auth linkage
 *   when the app is user-scoped.
 */

/** Column data types supported by the inferred data model. */
export type InferredColumnType =
  | 'uuid'
  | 'string'
  | 'text'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'email'
  | 'url'
  | 'json'

/** A single inferred column. */
export interface InferredColumn {
  name: string
  type: InferredColumnType
  required: boolean
  unique?: boolean
  /** Set when this column references another table's primary key. */
  references?: { table: string; column: string }
  /** Human-friendly reason this column was inferred (useful for UI/debugging). */
  note?: string
}

/** A single inferred table. */
export interface InferredTable {
  /** snake_case, pluralized identifier used as the ZeroDB table name. */
  name: string
  /** Singular, title-cased label for UI. */
  displayName: string
  columns: InferredColumn[]
  /** True when rows are owned by a user (adds user_id + auth requirement). */
  userScoped: boolean
}

/** The complete inferred backend model. */
export interface InferredSchema {
  tables: InferredTable[]
  /** Whether the app needs authentication (login/signup). */
  requiresAuth: boolean
  /** Whether a vector/semantic-search table was requested. */
  requiresVectorSearch: boolean
  /** Free-form notes explaining inference decisions. */
  notes: string[]
}

/** Options controlling inference behaviour. */
export interface InferenceOptions {
  /** Force auth on/off instead of inferring from the prompt. */
  requireAuth?: boolean
  /** Cap on number of tables to avoid runaway provisioning. Default 8. */
  maxTables?: number
}

const DEFAULT_MAX_TABLES = 8

/**
 * Common "entity" nouns that strongly imply a data table when they appear in a
 * builder prompt. Mapped to the columns that entity usually needs. This is a
 * curated library rather than an exhaustive one — anything not listed still
 * gets picked up by the generic noun extractor with a default column set.
 */
const ENTITY_LIBRARY: Record<string, { columns: InferredColumn[] }> = {
  task: {
    columns: [
      { name: 'title', type: 'string', required: true },
      { name: 'description', type: 'text', required: false },
      { name: 'status', type: 'string', required: false, note: 'e.g. todo/doing/done' },
      { name: 'due_date', type: 'datetime', required: false },
      { name: 'completed', type: 'boolean', required: false },
    ],
  },
  todo: {
    columns: [
      { name: 'title', type: 'string', required: true },
      { name: 'completed', type: 'boolean', required: false },
      { name: 'priority', type: 'integer', required: false },
    ],
  },
  note: {
    columns: [
      { name: 'title', type: 'string', required: true },
      { name: 'body', type: 'text', required: false },
      { name: 'pinned', type: 'boolean', required: false },
    ],
  },
  post: {
    columns: [
      { name: 'title', type: 'string', required: true },
      { name: 'slug', type: 'string', required: false, unique: true },
      { name: 'body', type: 'text', required: false },
      { name: 'published', type: 'boolean', required: false },
    ],
  },
  product: {
    columns: [
      { name: 'name', type: 'string', required: true },
      { name: 'description', type: 'text', required: false },
      { name: 'price', type: 'number', required: true },
      { name: 'sku', type: 'string', required: false, unique: true },
      { name: 'in_stock', type: 'boolean', required: false },
    ],
  },
  order: {
    columns: [
      { name: 'total', type: 'number', required: true },
      { name: 'status', type: 'string', required: false },
      { name: 'placed_at', type: 'datetime', required: false },
    ],
  },
  customer: {
    columns: [
      { name: 'name', type: 'string', required: true },
      { name: 'email', type: 'email', required: true, unique: true },
      { name: 'phone', type: 'string', required: false },
    ],
  },
  contact: {
    columns: [
      { name: 'name', type: 'string', required: true },
      { name: 'email', type: 'email', required: false },
      { name: 'phone', type: 'string', required: false },
    ],
  },
  user: {
    columns: [
      { name: 'email', type: 'email', required: true, unique: true },
      { name: 'name', type: 'string', required: false },
      { name: 'avatar_url', type: 'url', required: false },
    ],
  },
  event: {
    columns: [
      { name: 'title', type: 'string', required: true },
      { name: 'starts_at', type: 'datetime', required: true },
      { name: 'ends_at', type: 'datetime', required: false },
      { name: 'location', type: 'string', required: false },
    ],
  },
  comment: {
    columns: [
      { name: 'body', type: 'text', required: true },
    ],
  },
  message: {
    columns: [
      { name: 'body', type: 'text', required: true },
      { name: 'sent_at', type: 'datetime', required: false },
    ],
  },
  project: {
    columns: [
      { name: 'name', type: 'string', required: true },
      { name: 'description', type: 'text', required: false },
    ],
  },
  invoice: {
    columns: [
      { name: 'number', type: 'string', required: true, unique: true },
      { name: 'amount', type: 'number', required: true },
      { name: 'paid', type: 'boolean', required: false },
      { name: 'due_date', type: 'datetime', required: false },
    ],
  },
  booking: {
    columns: [
      { name: 'starts_at', type: 'datetime', required: true },
      { name: 'ends_at', type: 'datetime', required: false },
      { name: 'status', type: 'string', required: false },
    ],
  },
}

/** Irregular plurals we care about; everything else uses the +s/+es rule. */
const IRREGULAR_PLURALS: Record<string, string> = {
  person: 'people',
  category: 'categories',
  company: 'companies',
  activity: 'activities',
  inventory: 'inventories',
}

/** Words that look like nouns but are never data tables in this context. */
const NOISE_WORDS = new Set([
  'app',
  'application',
  'page',
  'website',
  'site',
  'dashboard',
  'ui',
  'interface',
  'button',
  'form',
  'list',
  'view',
  'data',
  'database',
  'backend',
  'frontend',
  'api',
  'user',
  'users',
  'login',
  'signup',
  'auth',
  'authentication',
  'thing',
  'things',
  'item',
  'items',
  'system',
  'feature',
  'section',
  'component',
])

/** Convert an arbitrary token to a snake_case identifier. */
export function toSnakeCase(input: string): string {
  return input
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()
}

/** Naive-but-correct-enough singularizer for our entity library. */
export function singularize(word: string): string {
  const w = word.toLowerCase()
  for (const [sing, plur] of Object.entries(IRREGULAR_PLURALS)) {
    if (w === plur) return sing
  }
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.endsWith('sses')) return w.slice(0, -2) // classes -> class
  if (w.endsWith('ses')) return w.slice(0, -2) // statuses -> status
  if (w.endsWith('es') && (w.endsWith('xes') || w.endsWith('ches') || w.endsWith('shes')))
    return w.slice(0, -2)
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

/** Pluralize a singular noun for use as a table name. */
export function pluralize(word: string): string {
  const w = word.toLowerCase()
  if (IRREGULAR_PLURALS[w]) return IRREGULAR_PLURALS[w]
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies'
  if (/(s|x|z|ch|sh)$/.test(w)) return w + 'es'
  return w + 's'
}

/** Title-case a singular noun for display. */
function titleCase(word: string): string {
  return word
    .split('_')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

/**
 * Does the prompt indicate the app needs authentication?
 * Looks for explicit auth language and for personalization cues ("my", "user's").
 */
export function detectAuthRequirement(prompt: string): boolean {
  const p = prompt.toLowerCase()
  const authSignals = [
    'auth',
    'login',
    'log in',
    'sign in',
    'sign up',
    'signup',
    'register',
    'account',
    'password',
    'user account',
    'per user',
    'per-user',
    'my ',
    "user's",
    'multi-user',
    'multi user',
    'permission',
    'role',
  ]
  return authSignals.some((s) => p.includes(s))
}

/** Does the prompt request semantic / vector search? */
export function detectVectorRequirement(prompt: string): boolean {
  const p = prompt.toLowerCase()
  return [
    'semantic search',
    'vector search',
    'similarity search',
    'embedding',
    'rag',
    'ai search',
  ].some((s) => p.includes(s))
}

/**
 * Extract candidate entity singulars from a prompt.
 * Strategy:
 *  1. Prefer known entities from ENTITY_LIBRARY (matched as whole words,
 *     singular or plural).
 *  2. Fall back to plural nouns in the text that survive the noise filter.
 * Returns an ordered, de-duplicated list of singular entity names.
 */
export function extractEntities(prompt: string): string[] {
  const p = prompt.toLowerCase()
  const found: string[] = []
  const seen = new Set<string>()

  const add = (singular: string) => {
    const key = toSnakeCase(singular)
    if (!key || key.length < 3) return
    if (NOISE_WORDS.has(key) || NOISE_WORDS.has(pluralize(key))) return
    if (seen.has(key)) return
    seen.add(key)
    found.push(key)
  }

  // 1. Known entities (match singular or plural as whole words).
  for (const entity of Object.keys(ENTITY_LIBRARY)) {
    const plural = pluralize(entity)
    const re = new RegExp(`\\b(${entity}|${plural})\\b`, 'i')
    if (re.test(p)) add(entity)
  }

  // 2. Generic plural-noun extraction for anything not in the library.
  const tokens = p.match(/[a-z][a-z0-9]{2,}/gi) || []
  for (const raw of tokens) {
    const token = raw.toLowerCase()
    // Only consider plausible plurals to avoid grabbing every verb/adjective.
    const looksPlural =
      token.endsWith('s') && !token.endsWith('ss') && !token.endsWith('us')
    if (!looksPlural) continue
    const singular = singularize(token)
    if (NOISE_WORDS.has(token) || NOISE_WORDS.has(singular)) continue
    add(singular)
  }

  return found
}

/** Build the standard system columns present on every table. */
function systemColumns(userScoped: boolean): InferredColumn[] {
  const cols: InferredColumn[] = [
    { name: 'id', type: 'uuid', required: true, unique: true, note: 'primary key' },
  ]
  if (userScoped) {
    cols.push({
      name: 'user_id',
      type: 'uuid',
      required: true,
      references: { table: 'users', column: 'id' },
      note: 'owner (auth-scoped)',
    })
  }
  cols.push(
    { name: 'created_at', type: 'datetime', required: true, note: 'auto timestamp' },
    { name: 'updated_at', type: 'datetime', required: true, note: 'auto timestamp' }
  )
  return cols
}

/** Build a single table from a singular entity name. */
function buildTable(entity: string, userScoped: boolean): InferredTable {
  const known = ENTITY_LIBRARY[entity]
  const domainColumns: InferredColumn[] = known
    ? known.columns.map((c) => ({ ...c }))
    : [
        { name: 'name', type: 'string', required: true },
        { name: 'description', type: 'text', required: false },
      ]

  const name = pluralize(entity)
  // Never double-scope the users table itself.
  const scoped = userScoped && name !== 'users'

  return {
    name,
    displayName: titleCase(entity),
    userScoped: scoped,
    columns: [...systemColumns(scoped), ...domainColumns],
  }
}

/**
 * Infer a complete backend data model from a natural-language prompt.
 * Pure and deterministic.
 */
export function inferSchema(
  prompt: string,
  options: InferenceOptions = {}
): InferredSchema {
  const maxTables = options.maxTables ?? DEFAULT_MAX_TABLES
  const notes: string[] = []

  const requiresAuth =
    options.requireAuth !== undefined
      ? options.requireAuth
      : detectAuthRequirement(prompt)
  const requiresVectorSearch = detectVectorRequirement(prompt)

  let entities = extractEntities(prompt)

  if (entities.length === 0) {
    // Nothing recognizable — fall back to a single generic "items" table so the
    // generated app still has a working backend to talk to.
    entities = ['item']
    notes.push('No specific entities detected; provisioned a generic "items" table.')
  }

  // Cap and de-dupe (extractEntities already de-dupes, but respect maxTables).
  if (entities.length > maxTables) {
    notes.push(
      `Detected ${entities.length} entities; capped to ${maxTables} tables.`
    )
    entities = entities.slice(0, maxTables)
  }

  const tables = entities.map((e) => buildTable(e, requiresAuth))

  // When auth is required, ensure a users table exists even if not named.
  if (requiresAuth && !tables.some((t) => t.name === 'users')) {
    tables.unshift(buildTable('user', false))
    notes.push('Auth requested: added a "users" table.')
  }

  if (requiresVectorSearch) {
    notes.push('Semantic search requested: a vector index should be provisioned.')
  }

  return { tables, requiresAuth, requiresVectorSearch, notes }
}

/** Render the inferred schema as a human-readable summary (for UI/logs). */
export function describeSchema(schema: InferredSchema): string {
  const lines: string[] = []
  lines.push(
    `${schema.tables.length} table(s)` +
      (schema.requiresAuth ? ', with authentication' : '') +
      (schema.requiresVectorSearch ? ', with vector search' : '')
  )
  for (const t of schema.tables) {
    lines.push(`- ${t.name} (${t.columns.length} columns)`)
  }
  return lines.join('\n')
}
