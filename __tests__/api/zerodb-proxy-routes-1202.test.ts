import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1202 (Coverage Phase 2 follow-up) — app/api/zerodb/[...path]/route.ts
 * (US-057) had zero route-level coverage despite being the largest
 * uncovered route file (~440 lines: GET/POST/PUT/DELETE/OPTIONS + its own
 * auth/table-name helpers). Mocks verifyJWT and the ZeroDB MCP client at
 * the boundary — no real network/DB/auth call.
 */

const authJwt = vi.hoisted(() => ({ verifyJWT: vi.fn() }))
vi.mock('@/lib/auth-jwt', () => ({ verifyJWT: authJwt.verifyJWT }))

const zerodb = vi.hoisted(() => ({ executeCRUD: vi.fn() }))
vi.mock('@/lib/mcp/zerodb-client', () => ({
  getZeroDBClient: () => ({ executeCRUD: zerodb.executeCRUD }),
  CRUDOperation: undefined,
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { mockGetRequest, mockJsonRequest, mockMalformedJsonRequest } from '../helpers/api-route-harness'

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * This route's dynamic segment is a catch-all (`[...path]` → `path: string[]`),
 * unlike the harness's `mockParams<T extends Record<string, string>>` which is
 * shaped for the single-string-segment routes most other route tests cover.
 * Local wrapper rather than widening the shared helper's generic for one route.
 */
function mockPathParams(path: string[]): { params: Promise<{ path: string[] }> } {
  return { params: Promise.resolve({ path }) }
}

function authedRequest(url: string, init?: { headers?: Record<string, string> }) {
  return mockGetRequest(url, { headers: { authorization: 'Bearer good-token', ...init?.headers } })
}

describe('#1202 GET /api/zerodb/[...path]', () => {
  it('returns 401 when no token is present (no header, no cookie)', async () => {
    const { GET } = await import('@/app/api/zerodb/[...path]/route')

    const res = await GET(mockGetRequest('http://localhost/api/zerodb/users'), mockPathParams(['users']))

    expect(res.status).toBe(401)
  })

  it('returns 401 when the token is invalid/expired', async () => {
    authJwt.verifyJWT.mockResolvedValue(null)
    const { GET } = await import('@/app/api/zerodb/[...path]/route')

    const res = await GET(authedRequest('http://localhost/api/zerodb/users'), mockPathParams(['users']))

    expect(res.status).toBe(401)
  })

  it('returns 400 when the table name is missing', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    const { GET } = await import('@/app/api/zerodb/[...path]/route')

    const res = await GET(authedRequest('http://localhost/api/zerodb/'), mockPathParams([]))

    expect(res.status).toBe(400)
  })

  it('returns 400 for an invalid table name', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    const { GET } = await import('@/app/api/zerodb/[...path]/route')

    const res = await GET(
      authedRequest('http://localhost/api/zerodb/1bad-table'),
      mockPathParams(['1bad-table'])
    )

    expect(res.status).toBe(400)
  })

  it('fetches a single record by id and returns 200', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    zerodb.executeCRUD.mockResolvedValue({ success: true, data: { id: 'rec-1', name: 'x' } })
    const { GET } = await import('@/app/api/zerodb/[...path]/route')

    const res = await GET(
      authedRequest('http://localhost/api/zerodb/widgets/rec-1'),
      mockPathParams(['widgets', 'rec-1'])
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, data: { id: 'rec-1', name: 'x' } })
    expect(zerodb.executeCRUD).toHaveBeenCalledWith({ operation: 'READ', table: 'widgets', where: { id: 'rec-1' } })
  })

  it('returns 404 when the single record does not exist', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    zerodb.executeCRUD.mockResolvedValue({ success: true, data: null })
    const { GET } = await import('@/app/api/zerodb/[...path]/route')

    const res = await GET(
      authedRequest('http://localhost/api/zerodb/widgets/missing'),
      mockPathParams(['widgets', 'missing'])
    )

    expect(res.status).toBe(404)
  })

  it('returns 500 when the single-record read fails', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    zerodb.executeCRUD.mockResolvedValue({ success: false, error: 'db down' })
    const { GET } = await import('@/app/api/zerodb/[...path]/route')

    const res = await GET(
      authedRequest('http://localhost/api/zerodb/widgets/rec-1'),
      mockPathParams(['widgets', 'rec-1'])
    )

    expect(res.status).toBe(500)
  })

  it('lists records with default pagination', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    zerodb.executeCRUD.mockResolvedValue({ success: true, data: [{ id: '1' }], count: 1 })
    const { GET } = await import('@/app/api/zerodb/[...path]/route')

    const res = await GET(authedRequest('http://localhost/api/zerodb/widgets'), mockPathParams(['widgets']))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.pagination).toEqual({ limit: 50, offset: 0, hasMore: false })
    expect(zerodb.executeCRUD).toHaveBeenCalledWith({
      operation: 'LIST',
      table: 'widgets',
      limit: 50,
      offset: 0,
      orderBy: undefined,
    })
  })

  it('lists records honoring limit/offset/orderBy/orderDir query params, capping the query itself at 100', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    zerodb.executeCRUD.mockResolvedValue({ success: true, data: [], count: 500 })
    const { GET } = await import('@/app/api/zerodb/[...path]/route')

    const res = await GET(
      authedRequest('http://localhost/api/zerodb/widgets?limit=9999&offset=10&orderBy=name&orderDir=DESC'),
      mockPathParams(['widgets'])
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    // hasMore is computed from the raw requested limit (9999), not the capped
    // query limit — so with count=500 and offset=10 it reads as "no more".
    expect(body.pagination).toEqual({ limit: 9999, offset: 10, hasMore: false })
    expect(zerodb.executeCRUD).toHaveBeenCalledWith({
      operation: 'LIST',
      table: 'widgets',
      limit: 100,
      offset: 10,
      orderBy: [{ column: 'name', direction: 'DESC' }],
    })
  })

  it('returns 500 when the list query fails', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    zerodb.executeCRUD.mockResolvedValue({ success: false, error: 'timeout' })
    const { GET } = await import('@/app/api/zerodb/[...path]/route')

    const res = await GET(authedRequest('http://localhost/api/zerodb/widgets'), mockPathParams(['widgets']))

    expect(res.status).toBe(500)
  })

  it('returns 500 (never crashes) on an unexpected thrown error', async () => {
    authJwt.verifyJWT.mockRejectedValue(new Error('boom'))
    const { GET } = await import('@/app/api/zerodb/[...path]/route')

    const res = await GET(authedRequest('http://localhost/api/zerodb/widgets'), mockPathParams(['widgets']))

    expect(res.status).toBe(500)
  })

  it('accepts the token from a cookie when there is no Authorization header', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    zerodb.executeCRUD.mockResolvedValue({ success: true, data: [], count: 0 })
    const { GET } = await import('@/app/api/zerodb/[...path]/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/zerodb/widgets', { headers: { cookie: 'auth-token=cookie-token' } }),
      mockPathParams(['widgets'])
    )

    expect(res.status).toBe(200)
    expect(authJwt.verifyJWT).toHaveBeenCalledWith('cookie-token')
  })
})

describe('#1202 POST /api/zerodb/[...path]', () => {
  it('returns 401 with no token', async () => {
    const { POST } = await import('@/app/api/zerodb/[...path]/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/zerodb/widgets', { name: 'x' }),
      mockPathParams(['widgets'])
    )

    expect(res.status).toBe(401)
  })

  it('returns 400 for an invalid table name', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    const { POST } = await import('@/app/api/zerodb/[...path]/route')

    const req = mockJsonRequest('http://localhost/api/zerodb/1bad', { name: 'x' })
    req.headers.set('authorization', 'Bearer good-token')
    const res = await POST(req, mockPathParams(['1bad']))

    expect(res.status).toBe(400)
  })

  it('returns 400 when the body is not a JSON object', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    const { POST } = await import('@/app/api/zerodb/[...path]/route')

    const req = mockJsonRequest('http://localhost/api/zerodb/widgets', null)
    req.headers.set('authorization', 'Bearer good-token')
    const res = await POST(req, mockPathParams(['widgets']))

    expect(res.status).toBe(400)
  })

  it('creates a record and returns 201', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    zerodb.executeCRUD.mockResolvedValue({ success: true, data: { id: 'new-1', name: 'x' } })
    const { POST } = await import('@/app/api/zerodb/[...path]/route')

    const req = mockJsonRequest('http://localhost/api/zerodb/widgets', { name: 'x' })
    req.headers.set('authorization', 'Bearer good-token')
    const res = await POST(req, mockPathParams(['widgets']))

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toEqual({ id: 'new-1', name: 'x' })
    expect(zerodb.executeCRUD).toHaveBeenCalledWith({ operation: 'CREATE', table: 'widgets', data: { name: 'x' } })
  })

  it('returns 500 when creation fails', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    zerodb.executeCRUD.mockResolvedValue({ success: false, error: 'constraint violation' })
    const { POST } = await import('@/app/api/zerodb/[...path]/route')

    const req = mockJsonRequest('http://localhost/api/zerodb/widgets', { name: 'x' })
    req.headers.set('authorization', 'Bearer good-token')
    const res = await POST(req, mockPathParams(['widgets']))

    expect(res.status).toBe(500)
  })

  it('returns 500 on malformed JSON body', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    const { POST } = await import('@/app/api/zerodb/[...path]/route')

    const req = mockMalformedJsonRequest('http://localhost/api/zerodb/widgets')
    req.headers.set('authorization', 'Bearer good-token')
    const res = await POST(req, mockPathParams(['widgets']))

    expect(res.status).toBe(500)
  })
})

describe('#1202 PUT /api/zerodb/[...path]', () => {
  it('returns 401 with no token', async () => {
    const { PUT } = await import('@/app/api/zerodb/[...path]/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/zerodb/widgets/rec-1', { name: 'y' }, { method: 'PUT' }),
      mockPathParams(['widgets', 'rec-1'])
    )

    expect(res.status).toBe(401)
  })

  it('returns 400 when the id is missing', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    const { PUT } = await import('@/app/api/zerodb/[...path]/route')

    const req = mockJsonRequest('http://localhost/api/zerodb/widgets', { name: 'y' }, { method: 'PUT' })
    req.headers.set('authorization', 'Bearer good-token')
    const res = await PUT(req, mockPathParams(['widgets']))

    expect(res.status).toBe(400)
  })

  it('returns 400 when the body is not a JSON object', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    const { PUT } = await import('@/app/api/zerodb/[...path]/route')

    const req = mockJsonRequest('http://localhost/api/zerodb/widgets/rec-1', null, { method: 'PUT' })
    req.headers.set('authorization', 'Bearer good-token')
    const res = await PUT(req, mockPathParams(['widgets', 'rec-1']))

    expect(res.status).toBe(400)
  })

  it('updates a record and returns 200', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    zerodb.executeCRUD.mockResolvedValue({ success: true, data: { id: 'rec-1', name: 'y' } })
    const { PUT } = await import('@/app/api/zerodb/[...path]/route')

    const req = mockJsonRequest('http://localhost/api/zerodb/widgets/rec-1', { name: 'y' }, { method: 'PUT' })
    req.headers.set('authorization', 'Bearer good-token')
    const res = await PUT(req, mockPathParams(['widgets', 'rec-1']))

    expect(res.status).toBe(200)
    expect(zerodb.executeCRUD).toHaveBeenCalledWith({
      operation: 'UPDATE',
      table: 'widgets',
      data: { name: 'y' },
      where: { id: 'rec-1' },
    })
  })

  it('returns 500 when the update fails', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    zerodb.executeCRUD.mockResolvedValue({ success: false, error: 'db down' })
    const { PUT } = await import('@/app/api/zerodb/[...path]/route')

    const req = mockJsonRequest('http://localhost/api/zerodb/widgets/rec-1', { name: 'y' }, { method: 'PUT' })
    req.headers.set('authorization', 'Bearer good-token')
    const res = await PUT(req, mockPathParams(['widgets', 'rec-1']))

    expect(res.status).toBe(500)
  })
})

describe('#1202 DELETE /api/zerodb/[...path]', () => {
  it('returns 401 with no token', async () => {
    const { DELETE } = await import('@/app/api/zerodb/[...path]/route')

    const res = await DELETE(
      mockGetRequest('http://localhost/api/zerodb/widgets/rec-1'),
      mockPathParams(['widgets', 'rec-1'])
    )

    expect(res.status).toBe(401)
  })

  it('returns 400 when the id is missing', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    const { DELETE } = await import('@/app/api/zerodb/[...path]/route')

    const res = await DELETE(authedRequest('http://localhost/api/zerodb/widgets'), mockPathParams(['widgets']))

    expect(res.status).toBe(400)
  })

  it('deletes the record and returns 200', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    zerodb.executeCRUD.mockResolvedValue({ success: true })
    const { DELETE } = await import('@/app/api/zerodb/[...path]/route')

    const res = await DELETE(
      authedRequest('http://localhost/api/zerodb/widgets/rec-1'),
      mockPathParams(['widgets', 'rec-1'])
    )

    expect(res.status).toBe(200)
    expect(zerodb.executeCRUD).toHaveBeenCalledWith({ operation: 'DELETE', table: 'widgets', where: { id: 'rec-1' } })
  })

  it('returns 500 when the delete fails', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    zerodb.executeCRUD.mockResolvedValue({ success: false, error: 'not found downstream' })
    const { DELETE } = await import('@/app/api/zerodb/[...path]/route')

    const res = await DELETE(
      authedRequest('http://localhost/api/zerodb/widgets/rec-1'),
      mockPathParams(['widgets', 'rec-1'])
    )

    expect(res.status).toBe(500)
  })

  it('returns 500 (never crashes) on an unexpected thrown error', async () => {
    authJwt.verifyJWT.mockResolvedValue({ userId: 'u1' })
    zerodb.executeCRUD.mockRejectedValue(new Error('boom'))
    const { DELETE } = await import('@/app/api/zerodb/[...path]/route')

    const res = await DELETE(
      authedRequest('http://localhost/api/zerodb/widgets/rec-1'),
      mockPathParams(['widgets', 'rec-1'])
    )

    expect(res.status).toBe(500)
  })
})

describe('#1202 OPTIONS /api/zerodb/[...path]', () => {
  it('returns a 200 CORS preflight response', async () => {
    const { OPTIONS } = await import('@/app/api/zerodb/[...path]/route')

    const res = await OPTIONS(mockGetRequest('http://localhost/api/zerodb/widgets'))

    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET')
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
  })
})
