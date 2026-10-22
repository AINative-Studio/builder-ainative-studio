import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1202 (Coverage Phase 2 follow-up) — app/api/auth/{login,logout,register}
 * had zero route-level coverage. These are the legacy email/password routes
 * (distinct from next-auth's own credentials provider) — thin wrappers over
 * lib/db/queries + lib/auth-jwt + bcrypt-ts, so everything real (DB, hashing,
 * JWT signing) is mocked at the boundary.
 */

const queries = vi.hoisted(() => ({
  getUser: vi.fn(),
  createUser: vi.fn(),
}))
vi.mock('@/lib/db/queries', () => ({
  getUser: queries.getUser,
  createUser: queries.createUser,
}))

const authJwt = vi.hoisted(() => ({
  generateJWT: vi.fn(),
  invalidateJWT: vi.fn(),
}))
vi.mock('@/lib/auth-jwt', () => ({
  generateJWT: authJwt.generateJWT,
  invalidateJWT: authJwt.invalidateJWT,
}))

const bcrypt = vi.hoisted(() => ({ compare: vi.fn() }))
vi.mock('bcrypt-ts', () => ({ compare: bcrypt.compare }))

import { mockJsonRequest, mockGetRequest, mockMalformedJsonRequest } from '../helpers/api-route-harness'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('#1202 POST /api/auth/login', () => {
  it('returns 400 for an invalid body (fails zod validation)', async () => {
    const { POST } = await import('@/app/api/auth/login/route')

    const res = await POST(mockJsonRequest('http://localhost/api/auth/login', { email: 'not-an-email', password: '' }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Validation failed')
  })

  it('returns 401 (timing-safe) when no user matches the email', async () => {
    queries.getUser.mockResolvedValue([])
    bcrypt.compare.mockResolvedValue(false)
    const { POST } = await import('@/app/api/auth/login/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/auth/login', { email: 'ghost@example.com', password: 'whatever' })
    )

    expect(res.status).toBe(401)
    // Still runs a dummy compare to avoid leaking "user doesn't exist" via timing.
    expect(bcrypt.compare).toHaveBeenCalledWith('whatever', expect.stringContaining('$2b$10$dummy'))
  })

  it('returns 401 when the stored user has no password set', async () => {
    queries.getUser.mockResolvedValue([{ id: 'u1', email: 'a@b.com', password: null }])
    const { POST } = await import('@/app/api/auth/login/route')

    const res = await POST(mockJsonRequest('http://localhost/api/auth/login', { email: 'a@b.com', password: 'x' }))

    expect(res.status).toBe(401)
  })

  it('returns 401 when the password does not match', async () => {
    queries.getUser.mockResolvedValue([{ id: 'u1', email: 'a@b.com', password: 'hashed' }])
    bcrypt.compare.mockResolvedValue(false)
    const { POST } = await import('@/app/api/auth/login/route')

    const res = await POST(mockJsonRequest('http://localhost/api/auth/login', { email: 'a@b.com', password: 'wrong' }))

    expect(res.status).toBe(401)
  })

  it('authenticates, sets the auth-token cookie, and returns 200 with the session', async () => {
    queries.getUser.mockResolvedValue([{ id: 'u1', email: 'a@b.com', password: 'hashed' }])
    bcrypt.compare.mockResolvedValue(true)
    authJwt.generateJWT.mockResolvedValue({ token: 'jwt-token', sessionId: 'sess-1' })
    const { POST } = await import('@/app/api/auth/login/route')

    const res = await POST(mockJsonRequest('http://localhost/api/auth/login', { email: 'a@b.com', password: 'correct' }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, user: { id: 'u1', email: 'a@b.com' }, sessionId: 'sess-1' })
    expect(res.cookies.get('auth-token')?.value).toBe('jwt-token')
  })

  it('returns 500 when the body is not valid JSON', async () => {
    const { POST } = await import('@/app/api/auth/login/route')

    const res = await POST(mockMalformedJsonRequest('http://localhost/api/auth/login'))

    expect(res.status).toBe(500)
  })

  it('returns 500 when the DB lookup throws', async () => {
    queries.getUser.mockRejectedValue(new Error('db down'))
    const { POST } = await import('@/app/api/auth/login/route')

    const res = await POST(mockJsonRequest('http://localhost/api/auth/login', { email: 'a@b.com', password: 'x' }))

    expect(res.status).toBe(500)
  })
})

describe('#1202 POST /api/auth/logout', () => {
  it('returns 401 when there is no auth-token cookie', async () => {
    const { POST } = await import('@/app/api/auth/logout/route')

    const res = await POST(mockGetRequest('http://localhost/api/auth/logout'))

    expect(res.status).toBe(401)
  })

  it('invalidates the session, clears the cookie, and returns 200', async () => {
    authJwt.invalidateJWT.mockResolvedValue(undefined)
    const { POST } = await import('@/app/api/auth/logout/route')

    const res = await POST(
      mockGetRequest('http://localhost/api/auth/logout', { headers: { cookie: 'auth-token=jwt-token' } })
    )

    expect(res.status).toBe(200)
    expect(authJwt.invalidateJWT).toHaveBeenCalledWith('jwt-token')
    expect(res.cookies.get('auth-token')?.value).toBe('')
  })

  it('returns 500 when invalidation throws', async () => {
    authJwt.invalidateJWT.mockRejectedValue(new Error('session store down'))
    const { POST } = await import('@/app/api/auth/logout/route')

    const res = await POST(
      mockGetRequest('http://localhost/api/auth/logout', { headers: { cookie: 'auth-token=jwt-token' } })
    )

    expect(res.status).toBe(500)
  })
})

describe('#1202 POST /api/auth/register', () => {
  const strongPassword = 'Str0ng!Passw0rd'

  it('returns 400 for an invalid body (weak password fails zod validation)', async () => {
    const { POST } = await import('@/app/api/auth/register/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/auth/register', { email: 'a@b.com', password: 'weak' })
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Validation failed')
  })

  it('returns 409 when a user already exists with that email', async () => {
    queries.getUser.mockResolvedValue([{ id: 'u1', email: 'a@b.com' }])
    const { POST } = await import('@/app/api/auth/register/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/auth/register', { email: 'a@b.com', password: strongPassword })
    )

    expect(res.status).toBe(409)
  })

  it('creates the user, sets the auth-token cookie, and returns 201', async () => {
    queries.getUser.mockResolvedValue([])
    queries.createUser.mockResolvedValue([{ id: 'new-1', email: 'a@b.com' }])
    authJwt.generateJWT.mockResolvedValue({ token: 'jwt-token', sessionId: 'sess-2' })
    const { POST } = await import('@/app/api/auth/register/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/auth/register', { email: 'a@b.com', password: strongPassword })
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toEqual({ success: true, user: { id: 'new-1', email: 'a@b.com' }, sessionId: 'sess-2' })
    expect(res.cookies.get('auth-token')?.value).toBe('jwt-token')
  })

  it('returns 500 when the body is not valid JSON', async () => {
    const { POST } = await import('@/app/api/auth/register/route')

    const res = await POST(mockMalformedJsonRequest('http://localhost/api/auth/register'))

    expect(res.status).toBe(500)
  })

  it('returns 500 when user creation throws', async () => {
    queries.getUser.mockResolvedValue([])
    queries.createUser.mockRejectedValue(new Error('db down'))
    const { POST } = await import('@/app/api/auth/register/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/auth/register', { email: 'a@b.com', password: strongPassword })
    )

    expect(res.status).toBe(500)
  })
})
