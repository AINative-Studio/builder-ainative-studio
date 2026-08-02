import { describe, it, expect } from 'vitest'
import {
  generateBackend,
  endpointsForTable,
  buildAuthScaffold,
  buildClientSdk,
} from '@/lib/services/fullstack-generator.service'
import { inferSchema } from '@/lib/services/schema-inference.service'

/**
 * Tests for the full-stack orchestrator (Issue #36). All tests use dryRun so no
 * network / ZeroDB calls are made; provisioning results are asserted as skipped.
 */
describe('fullstack-generator: endpointsForTable', () => {
  it('emits the five CRUD endpoints for a table', () => {
    const eps = endpointsForTable('tasks')
    const methods = eps.map((e) => e.method)
    expect(methods).toEqual(expect.arrayContaining(['GET', 'POST', 'PUT', 'DELETE']))
    expect(eps.every((e) => e.path.includes('/api/db/tasks'))).toBe(true)
  })
})

describe('fullstack-generator: buildAuthScaffold', () => {
  it('returns null when auth is not required', () => {
    const schema = inferSchema('a public product catalog')
    expect(buildAuthScaffold(schema)).toBeNull()
  })

  it('returns auth endpoints when auth is required', () => {
    const schema = inferSchema('users log in to manage tasks')
    const auth = buildAuthScaffold(schema)
    expect(auth).not.toBeNull()
    expect(auth!.enabled).toBe(true)
    const paths = auth!.endpoints.map((e) => e.path)
    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/auth/signup',
        '/api/auth/login',
        '/api/auth/me',
      ])
    )
  })
})

describe('fullstack-generator: buildClientSdk', () => {
  it('generates a typed client with a TableName union of provisioned tables', () => {
    const schema = inferSchema('manage tasks and notes')
    const sdk = buildClientSdk(schema)
    expect(sdk).toContain('export const db')
    expect(sdk).toContain("'tasks'")
    expect(sdk).toContain("'notes'")
    expect(sdk).toContain('async create(')
    expect(sdk).toContain('/api/db/')
  })

  it('does not leak an API key into the client', () => {
    const schema = inferSchema('tasks')
    const sdk = buildClientSdk(schema)
    expect(sdk.toLowerCase()).not.toContain('api-key')
    expect(sdk.toLowerCase()).not.toContain('x-api-key')
  })
})

describe('fullstack-generator: generateBackend (dry run)', () => {
  it('returns schema, endpoints, and a skipped provisioning result per table', async () => {
    const result = await generateBackend('a todo app to manage tasks', { dryRun: true })
    expect(result.schema.tables.length).toBeGreaterThan(0)
    expect(result.provisioned.every((p) => p.status === 'skipped')).toBe(true)
    // one provision entry per table
    expect(result.provisioned).toHaveLength(result.schema.tables.length)
    // CRUD endpoints present for the tasks table
    expect(result.endpoints.some((e) => e.path.includes('/api/db/tasks'))).toBe(true)
  })

  it('includes auth endpoints and scaffold when the prompt needs auth', async () => {
    const result = await generateBackend('users log in and manage their tasks', {
      dryRun: true,
    })
    expect(result.auth).not.toBeNull()
    expect(result.endpoints.some((e) => e.path === '/api/auth/login')).toBe(true)
  })

  it('omits auth scaffold for anonymous apps', async () => {
    const result = await generateBackend('a public product catalog', { dryRun: true })
    expect(result.auth).toBeNull()
    expect(result.endpoints.some((e) => e.path.startsWith('/api/auth'))).toBe(false)
  })

  it('uses the provided projectId', async () => {
    const result = await generateBackend('tasks', {
      dryRun: true,
      projectId: 'proj-123',
    })
    expect(result.projectId).toBe('proj-123')
  })

  it('produces a human-readable summary', async () => {
    const result = await generateBackend('manage tasks', { dryRun: true })
    expect(result.summary).toMatch(/table/i)
  })
})
