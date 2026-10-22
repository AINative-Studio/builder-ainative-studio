import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1202 (Coverage Phase 2) — /api/credentials and /api/credentials/[id] had
 * no route-level coverage. Both auth-gate (two different session helpers —
 * `auth()` for the collection route, `getSession()` for the [id] route,
 * worth locking down as-is rather than "fixing" since that's out of scope
 * here) then delegate to lib/services/credentials.service.
 */

const auth = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/app/(auth)/auth', () => ({ auth: auth.auth }))

const session = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ getSession: session.getSession }))

const creds = vi.hoisted(() => ({
  saveCredentials: vi.fn(),
  listCredentialPlatforms: vi.fn(),
  deleteCredentials: vi.fn(),
}))
vi.mock('@/lib/services/credentials.service', () => ({
  saveCredentials: creds.saveCredentials,
  listCredentialPlatforms: creds.listCredentialPlatforms,
  deleteCredentials: creds.deleteCredentials,
  Platform: undefined,
}))

import { mockGetRequest, mockJsonRequest, mockParams } from '../helpers/api-route-harness'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('#1202 GET /api/credentials', () => {
  it('returns 401 with no session', async () => {
    auth.auth.mockResolvedValue(null)
    const { GET } = await import('@/app/api/credentials/route')

    const res = await GET(mockGetRequest('http://localhost/api/credentials'))

    expect(res.status).toBe(401)
  })

  it('lists the saved platforms for the authenticated user', async () => {
    auth.auth.mockResolvedValue({ user: { id: 'user-1' } })
    creds.listCredentialPlatforms.mockResolvedValue(['vercel', 'railway'])
    const { GET } = await import('@/app/api/credentials/route')

    const res = await GET(mockGetRequest('http://localhost/api/credentials'))

    expect(res.status).toBe(200)
    expect((await res.json()).platforms).toEqual(['vercel', 'railway'])
  })

  it('returns 500 when the service throws', async () => {
    auth.auth.mockResolvedValue({ user: { id: 'user-1' } })
    creds.listCredentialPlatforms.mockRejectedValue(new Error('db down'))
    const { GET } = await import('@/app/api/credentials/route')

    const res = await GET(mockGetRequest('http://localhost/api/credentials'))

    expect(res.status).toBe(500)
  })
})

describe('#1202 POST /api/credentials', () => {
  it('returns 401 with no session', async () => {
    auth.auth.mockResolvedValue(null)
    const { POST } = await import('@/app/api/credentials/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/credentials', { platform: 'vercel', token: 'abcdefghij' })
    )

    expect(res.status).toBe(401)
  })

  it('returns 400 when the platform is not one of the allowed enum values', async () => {
    auth.auth.mockResolvedValue({ user: { id: 'user-1' } })
    const { POST } = await import('@/app/api/credentials/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/credentials', { platform: 'heroku', token: 'abcdefghij' })
    )

    expect(res.status).toBe(400)
  })

  it('returns 400 when the token is too short', async () => {
    auth.auth.mockResolvedValue({ user: { id: 'user-1' } })
    const { POST } = await import('@/app/api/credentials/route')

    const res = await POST(mockJsonRequest('http://localhost/api/credentials', { platform: 'vercel', token: 'x' }))

    expect(res.status).toBe(400)
  })

  it('saves valid credentials and returns 201', async () => {
    auth.auth.mockResolvedValue({ user: { id: 'user-1' } })
    creds.saveCredentials.mockResolvedValue('cred-id-1')
    const { POST } = await import('@/app/api/credentials/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/credentials', { platform: 'vercel', token: 'abcdefghij' })
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.credentialId).toBe('cred-id-1')
  })

  it('returns 500 when the save throws', async () => {
    auth.auth.mockResolvedValue({ user: { id: 'user-1' } })
    creds.saveCredentials.mockRejectedValue(new Error('encryption failed'))
    const { POST } = await import('@/app/api/credentials/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/credentials', { platform: 'vercel', token: 'abcdefghij' })
    )

    expect(res.status).toBe(500)
  })
})

describe('#1202 DELETE /api/credentials/[id]', () => {
  it('returns 401 with no session', async () => {
    session.getSession.mockResolvedValue(null)
    const { DELETE } = await import('@/app/api/credentials/[id]/route')

    const res = await DELETE(
      mockGetRequest('http://localhost/api/credentials/vercel'),
      mockParams({ id: 'vercel' })
    )

    expect(res.status).toBe(401)
  })

  it('deletes and returns 200 when found', async () => {
    session.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    creds.deleteCredentials.mockResolvedValue(true)
    const { DELETE } = await import('@/app/api/credentials/[id]/route')

    const res = await DELETE(
      mockGetRequest('http://localhost/api/credentials/vercel'),
      mockParams({ id: 'vercel' })
    )

    expect(res.status).toBe(200)
    expect(creds.deleteCredentials).toHaveBeenCalledWith('user-1', 'vercel')
  })

  it('returns 404 when there is nothing to delete', async () => {
    session.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    creds.deleteCredentials.mockResolvedValue(false)
    const { DELETE } = await import('@/app/api/credentials/[id]/route')

    const res = await DELETE(
      mockGetRequest('http://localhost/api/credentials/vercel'),
      mockParams({ id: 'vercel' })
    )

    expect(res.status).toBe(404)
  })

  it('returns 500 when the service throws', async () => {
    session.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    creds.deleteCredentials.mockRejectedValue(new Error('db down'))
    const { DELETE } = await import('@/app/api/credentials/[id]/route')

    const res = await DELETE(
      mockGetRequest('http://localhost/api/credentials/vercel'),
      mockParams({ id: 'vercel' })
    )

    expect(res.status).toBe(500)
  })
})
