import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1202 (Coverage Phase 3) — the design-tokens CRUD/upload/activate/revert
 * routes had zero route-level coverage (only /versions was previously
 * tested). All go through getAuthenticatedUser() for auth and lib/db/queries
 * for persistence; both are mocked at the boundary.
 */

const authHelper = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }))
vi.mock('@/lib/design-tokens/auth-helper', () => authHelper)

const queries = vi.hoisted(() => ({
  getDesignTokensByUserId: vi.fn(),
  createDesignToken: vi.fn(),
  getDesignToken: vi.fn(),
  setActiveDesignToken: vi.fn(),
  deleteDesignToken: vi.fn(),
}))
vi.mock('@/lib/db/queries', () => queries)

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const validators = vi.hoisted(() => ({ validateDesignTokens: vi.fn() }))
vi.mock('@/lib/design-tokens/validators', () => validators)

const parsers = vi.hoisted(() => ({ parseJSONTokens: vi.fn(), parseCSSVariables: vi.fn() }))
vi.mock('@/lib/design-tokens/parsers', () => parsers)

import { mockGetRequest, mockJsonRequest, mockParams } from '../helpers/api-route-harness'

const user = { userId: 'user-1', email: 'founder@example.com' }
const fullTokens = {
  colors: { primary: '#000', secondary: '#111', accent: '#222' },
  typography: { fontFamily: 'Inter', sizes: { base: '16px', xl: '24px', xs: '12px' } },
  spacing: { baseUnit: '4px' },
}

beforeEach(() => {
  vi.clearAllMocks()
  authHelper.getAuthenticatedUser.mockResolvedValue(user)
})

describe('#1202 GET /api/design-tokens', () => {
  it('returns 401 without an authenticated user', async () => {
    authHelper.getAuthenticatedUser.mockResolvedValue(null)
    const { GET } = await import('@/app/api/design-tokens/route')

    const res = await GET(mockGetRequest('http://localhost/api/design-tokens'))

    expect(res.status).toBe(401)
  })

  it('lists the user tokens transformed for the client', async () => {
    queries.getDesignTokensByUserId.mockResolvedValue([
      { id: 't1', user_id: 'user-1', name: 'Brand', is_active: true, version: '1.0.0', tokens: fullTokens, created_at: 'now' },
    ])
    const { GET } = await import('@/app/api/design-tokens/route')

    const res = await GET(mockGetRequest('http://localhost/api/design-tokens'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tokens[0]).toMatchObject({ id: 't1', isActive: true, currentVersion: '1.0.0' })
  })

  it('returns 500 when the query throws', async () => {
    queries.getDesignTokensByUserId.mockRejectedValue(new Error('db down'))
    const { GET } = await import('@/app/api/design-tokens/route')

    const res = await GET(mockGetRequest('http://localhost/api/design-tokens'))

    expect(res.status).toBe(500)
  })
})

describe('#1202 POST /api/design-tokens/upload', () => {
  const validBody = { name: 'Brand', version: '1.0.0', ...fullTokens }

  it('returns 401 without an authenticated user', async () => {
    authHelper.getAuthenticatedUser.mockResolvedValue(null)
    const { POST } = await import('@/app/api/design-tokens/upload/route')

    const res = await POST(mockJsonRequest('http://localhost/api/design-tokens/upload', validBody))

    expect(res.status).toBe(401)
  })

  it('returns 400 when name is missing', async () => {
    const { POST } = await import('@/app/api/design-tokens/upload/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/design-tokens/upload', { version: '1.0.0' })
    )

    expect(res.status).toBe(400)
  })

  it('returns 400 when version is missing', async () => {
    const { POST } = await import('@/app/api/design-tokens/upload/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/design-tokens/upload', { name: 'Brand' })
    )

    expect(res.status).toBe(400)
  })

  it('returns 400 when cssVariables fails to parse', async () => {
    parsers.parseCSSVariables.mockReturnValue(null)
    const { POST } = await import('@/app/api/design-tokens/upload/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/design-tokens/upload', {
        name: 'Brand',
        version: '1.0.0',
        cssVariables: ':root { --bad: true }',
      })
    )

    expect(res.status).toBe(400)
  })

  it('returns 400 when neither tokens nor cssVariables are given', async () => {
    const { POST } = await import('@/app/api/design-tokens/upload/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/design-tokens/upload', { name: 'Brand', version: '1.0.0' })
    )

    expect(res.status).toBe(400)
  })

  it('returns 400 when validation fails', async () => {
    validators.validateDesignTokens.mockReturnValue({ valid: false, errors: ['bad color'] })
    const { POST } = await import('@/app/api/design-tokens/upload/route')

    const res = await POST(mockJsonRequest('http://localhost/api/design-tokens/upload', validBody))

    expect(res.status).toBe(400)
  })

  it('returns 409 when the name+version already exists', async () => {
    validators.validateDesignTokens.mockReturnValue({ valid: true, warnings: [] })
    queries.getDesignTokensByUserId.mockResolvedValue([
      { name: 'Brand', version: '1.0.0' },
    ])
    const { POST } = await import('@/app/api/design-tokens/upload/route')

    const res = await POST(mockJsonRequest('http://localhost/api/design-tokens/upload', validBody))

    expect(res.status).toBe(409)
  })

  it('creates the token and returns a preview on success', async () => {
    validators.validateDesignTokens.mockReturnValue({ valid: true, warnings: [] })
    queries.getDesignTokensByUserId.mockResolvedValue([])
    queries.createDesignToken.mockResolvedValue([
      { id: 'tok-1', name: 'Brand', version: '1.0.0', is_active: false, created_at: 'now' },
    ])
    const { POST } = await import('@/app/api/design-tokens/upload/route')

    const res = await POST(mockJsonRequest('http://localhost/api/design-tokens/upload', validBody))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.preview).toContain('Design Token Preview')
  })

  it('parses via cssVariables when provided instead of direct tokens', async () => {
    parsers.parseCSSVariables.mockReturnValue(fullTokens)
    validators.validateDesignTokens.mockReturnValue({ valid: true, warnings: [] })
    queries.getDesignTokensByUserId.mockResolvedValue([])
    queries.createDesignToken.mockResolvedValue([
      { id: 'tok-1', name: 'Brand', version: '1.0.0', is_active: false, created_at: 'now' },
    ])
    const { POST } = await import('@/app/api/design-tokens/upload/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/design-tokens/upload', {
        name: 'Brand',
        version: '1.0.0',
        cssVariables: ':root { --color-primary: #000 }',
      })
    )

    expect(res.status).toBe(200)
  })

  it('returns 500 when creation throws', async () => {
    validators.validateDesignTokens.mockReturnValue({ valid: true, warnings: [] })
    queries.getDesignTokensByUserId.mockResolvedValue([])
    queries.createDesignToken.mockRejectedValue(new Error('db down'))
    const { POST } = await import('@/app/api/design-tokens/upload/route')

    const res = await POST(mockJsonRequest('http://localhost/api/design-tokens/upload', validBody))

    expect(res.status).toBe(500)
  })
})

describe('#1202 GET /api/design-tokens/[tokenId]', () => {
  it('returns 401 without an authenticated user', async () => {
    authHelper.getAuthenticatedUser.mockResolvedValue(null)
    const { GET } = await import('@/app/api/design-tokens/[tokenId]/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/design-tokens/t1'),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(401)
  })

  it('returns 404 when the token does not exist', async () => {
    queries.getDesignToken.mockResolvedValue(undefined)
    const { GET } = await import('@/app/api/design-tokens/[tokenId]/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/design-tokens/t1'),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(404)
  })

  it('returns 403 when the requester does not own the token', async () => {
    queries.getDesignToken.mockResolvedValue({ user_id: 'other-user' })
    const { GET } = await import('@/app/api/design-tokens/[tokenId]/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/design-tokens/t1'),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(403)
  })

  it('returns the token when owned', async () => {
    queries.getDesignToken.mockResolvedValue({ user_id: 'user-1', id: 't1' })
    const { GET } = await import('@/app/api/design-tokens/[tokenId]/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/design-tokens/t1'),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(200)
  })

  it('returns 500 when the lookup throws', async () => {
    queries.getDesignToken.mockRejectedValue(new Error('db down'))
    const { GET } = await import('@/app/api/design-tokens/[tokenId]/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/design-tokens/t1'),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(500)
  })
})

describe('#1202 PATCH /api/design-tokens/[tokenId]', () => {
  it('returns 404 when the token does not exist', async () => {
    queries.getDesignToken.mockResolvedValue(undefined)
    const { PATCH } = await import('@/app/api/design-tokens/[tokenId]/route')

    const res = await PATCH(
      mockGetRequest('http://localhost/api/design-tokens/t1'),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(404)
  })

  it('returns 403 when the requester does not own the token', async () => {
    queries.getDesignToken.mockResolvedValue({ user_id: 'other-user' })
    const { PATCH } = await import('@/app/api/design-tokens/[tokenId]/route')

    const res = await PATCH(
      mockGetRequest('http://localhost/api/design-tokens/t1'),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(403)
  })

  it('sets the token active when owned', async () => {
    queries.getDesignToken.mockResolvedValue({ user_id: 'user-1' })
    queries.setActiveDesignToken.mockResolvedValue([{ id: 't1', is_active: true }])
    const { PATCH } = await import('@/app/api/design-tokens/[tokenId]/route')

    const res = await PATCH(
      mockGetRequest('http://localhost/api/design-tokens/t1'),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(200)
  })

  it('returns 500 when the update throws', async () => {
    queries.getDesignToken.mockResolvedValue({ user_id: 'user-1' })
    queries.setActiveDesignToken.mockRejectedValue(new Error('db down'))
    const { PATCH } = await import('@/app/api/design-tokens/[tokenId]/route')

    const res = await PATCH(
      mockGetRequest('http://localhost/api/design-tokens/t1'),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(500)
  })
})

describe('#1202 DELETE /api/design-tokens/[tokenId]', () => {
  it('returns 404 when the token does not exist', async () => {
    queries.getDesignToken.mockResolvedValue(undefined)
    const { DELETE } = await import('@/app/api/design-tokens/[tokenId]/route')

    const res = await DELETE(
      mockGetRequest('http://localhost/api/design-tokens/t1'),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(404)
  })

  it('returns 403 when the requester does not own the token', async () => {
    queries.getDesignToken.mockResolvedValue({ user_id: 'other-user' })
    const { DELETE } = await import('@/app/api/design-tokens/[tokenId]/route')

    const res = await DELETE(
      mockGetRequest('http://localhost/api/design-tokens/t1'),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(403)
  })

  it('deletes the token when owned', async () => {
    queries.getDesignToken.mockResolvedValue({ user_id: 'user-1' })
    queries.deleteDesignToken.mockResolvedValue(undefined)
    const { DELETE } = await import('@/app/api/design-tokens/[tokenId]/route')

    const res = await DELETE(
      mockGetRequest('http://localhost/api/design-tokens/t1'),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(200)
  })

  it('returns 500 when deletion throws', async () => {
    queries.getDesignToken.mockResolvedValue({ user_id: 'user-1' })
    queries.deleteDesignToken.mockRejectedValue(new Error('db down'))
    const { DELETE } = await import('@/app/api/design-tokens/[tokenId]/route')

    const res = await DELETE(
      mockGetRequest('http://localhost/api/design-tokens/t1'),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(500)
  })
})

describe('#1202 PUT /api/design-tokens/[tokenId]/activate', () => {
  it('returns 401 without an authenticated user', async () => {
    authHelper.getAuthenticatedUser.mockResolvedValue(null)
    const { PUT } = await import('@/app/api/design-tokens/[tokenId]/activate/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/design-tokens/t1/activate', {}, { method: 'PUT' }),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(401)
  })

  it('returns 404 when the token does not exist', async () => {
    queries.getDesignToken.mockResolvedValue(undefined)
    const { PUT } = await import('@/app/api/design-tokens/[tokenId]/activate/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/design-tokens/t1/activate', {}, { method: 'PUT' }),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(404)
  })

  it('returns 403 when the requester does not own the token', async () => {
    queries.getDesignToken.mockResolvedValue({ user_id: 'other-user' })
    const { PUT } = await import('@/app/api/design-tokens/[tokenId]/activate/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/design-tokens/t1/activate', {}, { method: 'PUT' }),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(403)
  })

  it('activates the token when owned', async () => {
    queries.getDesignToken.mockResolvedValue({ user_id: 'user-1' })
    queries.setActiveDesignToken.mockResolvedValue([
      { id: 't1', name: 'Brand', version: '1.0.0', is_active: true },
    ])
    const { PUT } = await import('@/app/api/design-tokens/[tokenId]/activate/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/design-tokens/t1/activate', {}, { method: 'PUT' }),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(200)
  })

  it('returns 500 when activation throws', async () => {
    queries.getDesignToken.mockResolvedValue({ user_id: 'user-1' })
    queries.setActiveDesignToken.mockRejectedValue(new Error('db down'))
    const { PUT } = await import('@/app/api/design-tokens/[tokenId]/activate/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/design-tokens/t1/activate', {}, { method: 'PUT' }),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(500)
  })
})

describe('#1202 POST /api/design-tokens/[tokenId]/revert', () => {
  it('returns 401 without an authenticated user', async () => {
    authHelper.getAuthenticatedUser.mockResolvedValue(null)
    const { POST } = await import('@/app/api/design-tokens/[tokenId]/revert/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/design-tokens/t1/revert', { versionId: 'v1' }),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(401)
  })

  it('returns 400 when versionId is missing', async () => {
    const { POST } = await import('@/app/api/design-tokens/[tokenId]/revert/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/design-tokens/t1/revert', {}),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(400)
  })

  it('returns 404 when the target version does not exist', async () => {
    queries.getDesignToken.mockResolvedValue(undefined)
    const { POST } = await import('@/app/api/design-tokens/[tokenId]/revert/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/design-tokens/t1/revert', { versionId: 'v1' }),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(404)
  })

  it('returns 403 when the requester does not own the target version', async () => {
    queries.getDesignToken.mockResolvedValue({ user_id: 'other-user' })
    const { POST } = await import('@/app/api/design-tokens/[tokenId]/revert/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/design-tokens/t1/revert', { versionId: 'v1' }),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(403)
  })

  it('creates a new incremented-patch-version token on success', async () => {
    queries.getDesignToken.mockResolvedValue({
      user_id: 'user-1',
      name: 'Brand',
      version: '1.2.3',
      tokens: fullTokens,
      is_active: false,
    })
    queries.createDesignToken.mockResolvedValue([
      { id: 'new-1', name: 'Brand', version: '1.2.4', is_active: false, created_at: 'now' },
    ])
    const { POST } = await import('@/app/api/design-tokens/[tokenId]/revert/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/design-tokens/t1/revert', { versionId: 'v1' }),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token.version).toBe('1.2.4')
  })

  it('returns 500 when creation throws', async () => {
    queries.getDesignToken.mockResolvedValue({
      user_id: 'user-1',
      name: 'Brand',
      version: '1.2.3',
      tokens: fullTokens,
      is_active: false,
    })
    queries.createDesignToken.mockRejectedValue(new Error('db down'))
    const { POST } = await import('@/app/api/design-tokens/[tokenId]/revert/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/design-tokens/t1/revert', { versionId: 'v1' }),
      mockParams({ tokenId: 't1' })
    )

    expect(res.status).toBe(500)
  })
})
