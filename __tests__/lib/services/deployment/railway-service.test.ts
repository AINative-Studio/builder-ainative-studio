import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Unit tests for Railway deployment service (US-069).
 *
 * All Railway calls go through a single GraphQL POST to backboard.railway.app
 * via global `fetch` — mocked per-call based on the query text, since the
 * service issues several distinct GraphQL operations per deploy.
 */

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))
vi.mock('@/lib/db/schema', () => ({ deployments: {}, generations: {} }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn((a, b) => ({ a, b })) }))

const getCredentialsWithFallbackMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/credentials.service', () => ({
  getCredentialsWithFallback: getCredentialsWithFallbackMock,
}))

const exportProjectMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/export.service', () => ({
  exportProject: exportProjectMock,
}))

function selectChain(rows: any[]) {
  return { from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) }
}
function insertChain(row: any) {
  return { values: () => ({ returning: () => Promise.resolve([row]) }) }
}
function updateChain() {
  return { set: () => ({ where: () => Promise.resolve(undefined) }) }
}

/** Builds a fetch mock that responds based on which GraphQL operation name appears in the request body. */
function graphqlRouter(handlers: Record<string, (vars: any) => any>) {
  return vi.fn(async (_url: string, options: any) => {
    const body = JSON.parse(options.body)
    const opMatch = Object.keys(handlers).find((name) => body.query.includes(name))
    if (!opMatch) {
      throw new Error(`No handler registered for GraphQL operation in query: ${body.query}`)
    }
    const data = handlers[opMatch](body.variables)
    return { ok: true, json: async () => ({ data }) }
  })
}

describe('deployToRailway', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  beforeEach(() => {
    vi.clearAllMocks()
    exportProjectMock.mockResolvedValue(Buffer.from('zip-bytes'))
    dbMock.insert.mockReturnValue(insertChain({ id: 'deploy-1' }))
    dbMock.update.mockReturnValue(updateChain())
  })

  it('throws when no API token is available', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue(null)
    const { deployToRailway } = await import('@/lib/services/deployment/railway.service')

    await expect(
      deployToRailway({ generationId: 'gen-1', userId: 'user-1' })
    ).rejects.toThrow('Railway API token not found')
  })

  it('throws when the generation does not exist', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('token')
    dbMock.select.mockReturnValue(selectChain([]))
    const { deployToRailway } = await import('@/lib/services/deployment/railway.service')

    await expect(
      deployToRailway({ generationId: 'missing', userId: 'user-1' })
    ).rejects.toThrow('Generation not found')
  })

  it('throws when the generation belongs to a different user', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('token')
    dbMock.select.mockReturnValue(selectChain([{ id: 'gen-1', user_id: 'other' }]))
    const { deployToRailway } = await import('@/lib/services/deployment/railway.service')

    await expect(
      deployToRailway({ generationId: 'gen-1', userId: 'user-1' })
    ).rejects.toThrow('Unauthorized access to generation')
  })

  it('deploys end-to-end: creates project, reuses an existing matching environment, creates service, and resolves the domain', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('token')
    dbMock.select.mockReturnValue(selectChain([{ id: 'gen-1', user_id: 'user-1' }]))

    global.fetch = graphqlRouter({
      ProjectCreate: () => ({ projectCreate: { id: 'proj-1', name: 'ai-generated-gen-1' } }),
      Project: () => ({
        project: {
          environments: {
            edges: [{ node: { id: 'env-1', name: 'production' } }],
          },
        },
      }),
      ServiceCreate: () => ({ serviceCreate: { id: 'svc-1', name: 'nextjs-app' } }),
      ServiceDomain: () => ({ serviceDomain: { domain: 'my-app.up.railway.app' } }),
    }) as any

    const { deployToRailway } = await import('@/lib/services/deployment/railway.service')
    const result = await deployToRailway({ generationId: 'gen-1', userId: 'user-1' })

    expect(result).toBe('deploy-1')
  })

  it('creates a new environment when none matches the requested name', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('token')
    dbMock.select.mockReturnValue(selectChain([{ id: 'gen-1', user_id: 'user-1' }]))

    global.fetch = graphqlRouter({
      ProjectCreate: () => ({ projectCreate: { id: 'proj-1', name: 'x' } }),
      Project: () => ({ project: { environments: { edges: [] } } }),
      EnvironmentCreate: (vars: any) => ({
        environmentCreate: { id: 'env-new', name: vars.name },
      }),
      ServiceCreate: () => ({ serviceCreate: { id: 'svc-1', name: 'nextjs-app' } }),
      ServiceDomain: () => ({ serviceDomain: { domain: 'x.up.railway.app' } }),
    }) as any

    const { deployToRailway } = await import('@/lib/services/deployment/railway.service')
    const result = await deployToRailway({ generationId: 'gen-1', userId: 'user-1', environmentName: 'staging' })

    expect(result).toBe('deploy-1')
  })

  it('marks the deployment errored and rethrows on a non-2xx GraphQL HTTP response', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('token')
    dbMock.select.mockReturnValue(selectChain([{ id: 'gen-1', user_id: 'user-1' }]))

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    }) as any

    const { deployToRailway } = await import('@/lib/services/deployment/railway.service')

    await expect(
      deployToRailway({ generationId: 'gen-1', userId: 'user-1' })
    ).rejects.toThrow('Railway API error (401)')
  })

  it('rethrows a GraphQL-level error payload even on HTTP 200', async () => {
    getCredentialsWithFallbackMock.mockResolvedValue('token')
    dbMock.select.mockReturnValue(selectChain([{ id: 'gen-1', user_id: 'user-1' }]))

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ errors: [{ message: 'Project limit reached' }] }),
    }) as any

    const { deployToRailway } = await import('@/lib/services/deployment/railway.service')

    await expect(
      deployToRailway({ generationId: 'gen-1', userId: 'user-1' })
    ).rejects.toThrow('Railway GraphQL error')
  })
})

describe('getRailwayDeploymentStatus', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns status and url from the deployment query', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { deployment: { status: 'SUCCESS', url: 'https://x.up.railway.app' } } }),
    }) as any

    const { getRailwayDeploymentStatus } = await import('@/lib/services/deployment/railway.service')
    const result = await getRailwayDeploymentStatus('dep-1', 'token')

    expect(result).toEqual({ status: 'SUCCESS', url: 'https://x.up.railway.app' })
  })

  it('throws on a failed HTTP response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'err' }) as any
    const { getRailwayDeploymentStatus } = await import('@/lib/services/deployment/railway.service')

    await expect(getRailwayDeploymentStatus('dep-1', 'token')).rejects.toThrow('Railway API error (500)')
  })
})

describe('deleteRailwayProject', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('issues the ProjectDelete mutation and resolves', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { projectDelete: true } }),
    }) as any

    const { deleteRailwayProject } = await import('@/lib/services/deployment/railway.service')
    await expect(deleteRailwayProject('proj-1', 'token')).resolves.toBeUndefined()

    const [, options] = (global.fetch as any).mock.calls[0]
    expect(JSON.parse(options.body).query).toContain('ProjectDelete')
  })
})
