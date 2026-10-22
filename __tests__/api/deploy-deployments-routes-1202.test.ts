import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * #1202 (Coverage Phase 2, pass 4) — the three deployment-management routes
 * (app/api/deploy, app/api/deployments, app/api/deployments/[id]) had zero
 * route-level coverage. All real I/O (session, drizzle db, and each
 * platform deployment service) is mocked at the module boundary.
 */

const sessionMock = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/lib/auth/session', () => sessionMock)

const deploymentServices = vi.hoisted(() => ({
  deployToVercel: vi.fn(),
  deployToNetlify: vi.fn(),
  deployToRailway: vi.fn(),
  deployToAINativeCloud: vi.fn(),
}))
vi.mock('@/lib/services/deployment/vercel.service', () => ({ deployToVercel: deploymentServices.deployToVercel }))
vi.mock('@/lib/services/deployment/netlify.service', () => ({ deployToNetlify: deploymentServices.deployToNetlify }))
vi.mock('@/lib/services/deployment/railway.service', () => ({ deployToRailway: deploymentServices.deployToRailway }))
vi.mock('@/lib/services/deployment/ainative-cloud.service', () => ({ deployToAINativeCloud: deploymentServices.deployToAINativeCloud }))

const dbMock = vi.hoisted(() => {
  const chain: any = {
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve([])),
    delete: vi.fn(() => chain),
    returning: vi.fn(() => Promise.resolve([])),
  }
  return { db: chain }
})
vi.mock('@/lib/db', () => dbMock)

vi.mock('@/lib/db/schema', () => ({
  deployments: { id: 'id', user_id: 'user_id', created_at: 'created_at' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  desc: vi.fn((a: unknown) => ({ op: 'desc', a })),
}))

function jsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/deploy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

const VALID_GENERATION_ID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.resetAllMocks()
  sessionMock.getSession.mockResolvedValue(null)
  dbMock.db.select.mockReturnValue(dbMock.db)
  dbMock.db.from.mockReturnValue(dbMock.db)
  dbMock.db.where.mockReturnValue(dbMock.db)
  dbMock.db.orderBy.mockReturnValue(dbMock.db)
  dbMock.db.delete.mockReturnValue(dbMock.db)
  dbMock.db.limit.mockResolvedValue([])
  dbMock.db.returning.mockResolvedValue([])
})

describe('#1202 POST /api/deploy', () => {
  it('returns 401 when there is no session', async () => {
    const { POST } = await import('@/app/api/deploy/route')
    const res = await POST(jsonRequest({ generationId: VALID_GENERATION_ID, platform: 'vercel' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for a request that fails schema validation', async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: 'u1' } })
    const { POST } = await import('@/app/api/deploy/route')
    const res = await POST(jsonRequest({ generationId: 'not-a-uuid', platform: 'nope' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid request')
  })

  it('returns 429 when the user has hit the hourly rate limit', async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: 'u1' } })
    const now = new Date()
    dbMock.db.limit.mockResolvedValue(
      Array.from({ length: 5 }, () => ({ created_at: now })),
    )
    const { POST } = await import('@/app/api/deploy/route')
    const res = await POST(jsonRequest({ generationId: VALID_GENERATION_ID, platform: 'vercel' }))
    expect(res.status).toBe(429)
  })

  it('deploys to vercel and returns 202 with deployment details', async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: 'u1' } })
    deploymentServices.deployToVercel.mockResolvedValue('dep-1')
    dbMock.db.limit
      .mockResolvedValueOnce([]) // rate-limit check
      .mockResolvedValueOnce([{ id: 'dep-1', status: 'queued', url: null, platform: 'vercel', metadata: {} }])

    const { POST } = await import('@/app/api/deploy/route')
    const res = await POST(jsonRequest({ generationId: VALID_GENERATION_ID, platform: 'vercel', projectName: 'my-app' }))

    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.deploymentId).toBe('dep-1')
    expect(deploymentServices.deployToVercel).toHaveBeenCalledWith(
      expect.objectContaining({ generationId: VALID_GENERATION_ID, userId: 'u1', projectName: 'my-app' }),
    )
  })

  it('deploys to netlify, falling back siteName to projectName', async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: 'u1' } })
    deploymentServices.deployToNetlify.mockResolvedValue('dep-2')
    dbMock.db.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'dep-2', status: 'queued', url: null, platform: 'netlify', metadata: {} }])

    const { POST } = await import('@/app/api/deploy/route')
    const res = await POST(jsonRequest({ generationId: VALID_GENERATION_ID, platform: 'netlify', projectName: 'fallback-name' }))

    expect(res.status).toBe(202)
    expect(deploymentServices.deployToNetlify).toHaveBeenCalledWith(
      expect.objectContaining({ siteName: 'fallback-name' }),
    )
  })

  it('deploys to railway', async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: 'u1' } })
    deploymentServices.deployToRailway.mockResolvedValue('dep-3')
    dbMock.db.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'dep-3', status: 'queued', url: null, platform: 'railway', metadata: {} }])

    const { POST } = await import('@/app/api/deploy/route')
    const res = await POST(jsonRequest({ generationId: VALID_GENERATION_ID, platform: 'railway' }))

    expect(res.status).toBe(202)
    expect(deploymentServices.deployToRailway).toHaveBeenCalled()
  })

  it('deploys to ainative-cloud', async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: 'u1' } })
    deploymentServices.deployToAINativeCloud.mockResolvedValue('dep-4')
    dbMock.db.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'dep-4', status: 'queued', url: null, platform: 'ainative-cloud', metadata: {} }])

    const { POST } = await import('@/app/api/deploy/route')
    const res = await POST(jsonRequest({ generationId: VALID_GENERATION_ID, platform: 'ainative-cloud', region: 'us-east' }))

    expect(res.status).toBe(202)
    expect(deploymentServices.deployToAINativeCloud).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'us-east' }),
    )
  })

  it('returns 500 when the deployment service throws', async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: 'u1' } })
    deploymentServices.deployToVercel.mockRejectedValue(new Error('vercel API down'))
    dbMock.db.limit.mockResolvedValueOnce([])

    const { POST } = await import('@/app/api/deploy/route')
    const res = await POST(jsonRequest({ generationId: VALID_GENERATION_ID, platform: 'vercel' }))

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.details).toBe('vercel API down')
  })
})

describe('#1202 GET /api/deployments', () => {
  it('returns 401 when there is no session', async () => {
    const { GET } = await import('@/app/api/deployments/route')
    const res = await GET({} as any)
    expect(res.status).toBe(401)
  })

  it('returns the user\'s deployments', async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: 'u1' } })
    dbMock.db.limit.mockResolvedValue([{ id: 'd1' }, { id: 'd2' }])

    const { GET } = await import('@/app/api/deployments/route')
    const res = await GET({} as any)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deployments).toHaveLength(2)
  })

  it('returns 500 when the db query throws', async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: 'u1' } })
    dbMock.db.limit.mockRejectedValue(new Error('db down'))

    const { GET } = await import('@/app/api/deployments/route')
    const res = await GET({} as any)
    expect(res.status).toBe(500)
  })
})

describe('#1202 GET /api/deployments/[id]', () => {
  it('returns 401 when there is no session', async () => {
    const { GET } = await import('@/app/api/deployments/[id]/route')
    const res = await GET({} as any, params('d1'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when the deployment does not exist (or is not owned by the user)', async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: 'u1' } })
    dbMock.db.limit.mockResolvedValue([])

    const { GET } = await import('@/app/api/deployments/[id]/route')
    const res = await GET({} as any, params('missing'))
    expect(res.status).toBe(404)
  })

  it('returns the deployment when found', async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: 'u1' } })
    dbMock.db.limit.mockResolvedValue([{ id: 'd1', status: 'success' }])

    const { GET } = await import('@/app/api/deployments/[id]/route')
    const res = await GET({} as any, params('d1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deployment).toEqual({ id: 'd1', status: 'success' })
  })

  it('returns 500 when the fetch throws', async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: 'u1' } })
    dbMock.db.limit.mockRejectedValue(new Error('db down'))

    const { GET } = await import('@/app/api/deployments/[id]/route')
    const res = await GET({} as any, params('d1'))
    expect(res.status).toBe(500)
  })
})

describe('#1202 DELETE /api/deployments/[id]', () => {
  it('returns 401 when there is no session', async () => {
    const { DELETE } = await import('@/app/api/deployments/[id]/route')
    const res = await DELETE({} as any, params('d1'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when nothing was deleted', async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: 'u1' } })
    dbMock.db.returning.mockResolvedValue([])

    const { DELETE } = await import('@/app/api/deployments/[id]/route')
    const res = await DELETE({} as any, params('missing'))
    expect(res.status).toBe(404)
  })

  it('deletes the deployment and returns success', async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: 'u1' } })
    dbMock.db.returning.mockResolvedValue([{ id: 'd1' }])

    const { DELETE } = await import('@/app/api/deployments/[id]/route')
    const res = await DELETE({} as any, params('d1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, message: 'Deployment deleted' })
  })

  it('returns 500 when the delete throws', async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: 'u1' } })
    dbMock.db.returning.mockRejectedValue(new Error('db down'))

    const { DELETE } = await import('@/app/api/deployments/[id]/route')
    const res = await DELETE({} as any, params('d1'))
    expect(res.status).toBe(500)
  })
})
