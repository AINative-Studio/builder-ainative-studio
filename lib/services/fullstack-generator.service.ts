/**
 * Full-Stack Generator Service (Issue #36)
 *
 * Orchestrates the "UI-only -> full-stack" upgrade:
 *   prompt --> infer schema --> provision ZeroDB tables --> emit API + auth +
 *   client-SDK artifacts the generated UI can consume.
 *
 * The inference layer (schema-inference.service) is pure; this layer is where
 * the side effects live (ZeroDB REST calls). Provisioning is best-effort and
 * idempotent: ZeroDB auto-creates tables on first insert, so a failed create
 * call never blocks generation — we surface it in the result instead.
 */

import {
  inferSchema,
  describeSchema,
  InferredSchema,
  InferredTable,
  InferenceOptions,
} from './schema-inference.service'
import { logger } from '../logger'

const ZERODB_API = process.env.ZERODB_API_BASE_URL || 'https://api.ainative.studio/api'
const DEFAULT_PROJECT_ID =
  process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
const API_KEY = process.env.ZERODB_API_KEY || ''

/** REST endpoint descriptor for a provisioned table (as exposed via /api/db). */
export interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  description: string
}

/** Result of provisioning a single table. */
export interface TableProvisionResult {
  table: string
  status: 'created' | 'exists' | 'skipped' | 'failed'
  detail?: string
}

/** Complete result of a full-stack generation request. */
export interface FullStackResult {
  schema: InferredSchema
  summary: string
  projectId: string
  provisioned: TableProvisionResult[]
  endpoints: ApiEndpoint[]
  /** Ready-to-embed TypeScript client for the generated UI. */
  clientSdk: string
  /** Auth scaffold info (present only when the schema requires auth). */
  auth: AuthScaffold | null
}

/** Auth scaffold surfaced to the generated app. */
export interface AuthScaffold {
  enabled: boolean
  provider: 'ainative'
  endpoints: ApiEndpoint[]
  note: string
}

export interface GenerateBackendOptions extends InferenceOptions {
  /** Override the ZeroDB project to provision into. */
  projectId?: string
  /** Skip network provisioning (dry run) — used in tests/preview. */
  dryRun?: boolean
}

/** Build the /api/db endpoint descriptors for one table. */
export function endpointsForTable(table: string): ApiEndpoint[] {
  return [
    { method: 'GET', path: `/api/db/${table}`, description: `List ${table}` },
    {
      method: 'GET',
      path: `/api/db/${table}?filter={...}`,
      description: `Query ${table} with filters`,
    },
    { method: 'POST', path: `/api/db/${table}`, description: `Create a ${table} row` },
    {
      method: 'PUT',
      path: `/api/db/${table}?id={id}`,
      description: `Update a ${table} row`,
    },
    {
      method: 'DELETE',
      path: `/api/db/${table}?id={id}`,
      description: `Delete a ${table} row`,
    },
  ]
}

/** Build the auth scaffold descriptor when the schema requires auth. */
export function buildAuthScaffold(schema: InferredSchema): AuthScaffold | null {
  if (!schema.requiresAuth) return null
  return {
    enabled: true,
    provider: 'ainative',
    endpoints: [
      { method: 'POST', path: '/api/auth/signup', description: 'Register a new user' },
      { method: 'POST', path: '/api/auth/login', description: 'Log in and start a session' },
      { method: 'POST', path: '/api/auth/logout', description: 'End the session' },
      { method: 'GET', path: '/api/auth/me', description: 'Get the current user' },
    ],
    note:
      'User-scoped tables include a user_id column; filter rows by the authenticated user.',
  }
}

/** Generate a small, dependency-free TS client the generated UI can drop in. */
export function buildClientSdk(schema: InferredSchema): string {
  const tableNames = schema.tables.map((t) => t.name)
  const union = tableNames.map((t) => `'${t}'`).join(' | ') || 'string'
  return [
    '// Auto-generated ZeroDB client for this app (Issue #36).',
    '// No API key is exposed — all calls proxy through /api/db.',
    `export type TableName = ${union}`,
    '',
    'export const db = {',
    '  async list(table: TableName, limit = 50) {',
    '    const res = await fetch(`/api/db/${table}?limit=${limit}`)',
    '    if (!res.ok) throw new Error(`list ${table} failed: ${res.status}`)',
    '    return res.json()',
    '  },',
    '  async query(table: TableName, filters: Record<string, unknown>, limit = 50) {',
    '    const qs = new URLSearchParams({ filter: JSON.stringify(filters), limit: String(limit) })',
    '    const res = await fetch(`/api/db/${table}?${qs}`)',
    '    if (!res.ok) throw new Error(`query ${table} failed: ${res.status}`)',
    '    return res.json()',
    '  },',
    '  async create(table: TableName, row: Record<string, unknown>) {',
    '    const res = await fetch(`/api/db/${table}`, {',
    "      method: 'POST',",
    "      headers: { 'Content-Type': 'application/json' },",
    '      body: JSON.stringify(row),',
    '    })',
    '    if (!res.ok) throw new Error(`create ${table} failed: ${res.status}`)',
    '    return res.json()',
    '  },',
    '  async update(table: TableName, id: string, row: Record<string, unknown>) {',
    '    const res = await fetch(`/api/db/${table}?id=${id}`, {',
    "      method: 'PUT',",
    "      headers: { 'Content-Type': 'application/json' },",
    '      body: JSON.stringify(row),',
    '    })',
    '    if (!res.ok) throw new Error(`update ${table} failed: ${res.status}`)',
    '    return res.json()',
    '  },',
    '  async remove(table: TableName, id: string) {',
    '    const res = await fetch(`/api/db/${table}?id=${id}`, { method: \'DELETE\' })',
    '    if (!res.ok) throw new Error(`delete ${table} failed: ${res.status}`)',
    '    return res.json()',
    '  },',
    '}',
    '',
  ].join('\n')
}

/** Provision a single table in ZeroDB (idempotent, best-effort). */
async function provisionTable(
  projectId: string,
  table: InferredTable
): Promise<TableProvisionResult> {
  if (!API_KEY) {
    return {
      table: table.name,
      status: 'skipped',
      detail: 'ZERODB_API_KEY not set',
    }
  }

  try {
    const res = await fetch(
      `${ZERODB_API}/v1/projects/${projectId}/database/tables`,
      {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table_name: table.name,
          // ZeroDB is schema-flexible; we pass the inferred shape as a hint.
          schema: {
            columns: table.columns.map((c) => ({
              name: c.name,
              type: c.type,
              required: c.required,
              unique: c.unique ?? false,
            })),
          },
        }),
        signal: AbortSignal.timeout(10000),
      }
    )

    if (res.ok) {
      return { table: table.name, status: 'created' }
    }
    // Treat "already exists" style responses as a non-error.
    if (res.status === 409) {
      return { table: table.name, status: 'exists' }
    }
    const detail = await res.text().catch(() => '')
    logger.warn('Table provisioning returned non-OK', {
      table: table.name,
      status: res.status,
    })
    return { table: table.name, status: 'failed', detail: `${res.status} ${detail}`.trim() }
  } catch (error) {
    logger.error('Table provisioning error', error as Error, { table: table.name })
    return {
      table: table.name,
      status: 'failed',
      detail: error instanceof Error ? error.message : 'unknown error',
    }
  }
}

/**
 * Full-stack backend generation entry point.
 * Infers the schema, provisions tables (unless dryRun), and returns everything
 * the UI-generation step and the deploy step need.
 */
export async function generateBackend(
  prompt: string,
  options: GenerateBackendOptions = {}
): Promise<FullStackResult> {
  const projectId = options.projectId || DEFAULT_PROJECT_ID
  const schema = inferSchema(prompt, options)

  logger.info('Full-stack backend inferred', {
    tables: schema.tables.map((t) => t.name),
    requiresAuth: schema.requiresAuth,
  })

  let provisioned: TableProvisionResult[]
  if (options.dryRun) {
    provisioned = schema.tables.map((t) => ({
      table: t.name,
      status: 'skipped' as const,
      detail: 'dry run',
    }))
  } else {
    provisioned = await Promise.all(
      schema.tables.map((t) => provisionTable(projectId, t))
    )
  }

  const endpoints = schema.tables.flatMap((t) => endpointsForTable(t.name))
  const auth = buildAuthScaffold(schema)
  if (auth) endpoints.push(...auth.endpoints)

  return {
    schema,
    summary: describeSchema(schema),
    projectId,
    provisioned,
    endpoints,
    clientSdk: buildClientSdk(schema),
    auth,
  }
}
