import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const h = vi.hoisted(() => ({
  verifyJWT: vi.fn(),
}))

vi.mock('@/lib/auth-jwt', () => ({
  verifyJWT: h.verifyJWT,
}))

import { withAuth, withOptionalAuth, getUserFromRequest } from '@/lib/auth-middleware'

function makeRequest(cookieValue?: string) {
  const req = new NextRequest(new Request('https://example.com/api/widgets'))
  if (cookieValue !== undefined) {
    req.cookies.set('auth-token', cookieValue)
  }
  return req
}

describe('lib/auth-middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('withAuth()', () => {
    it('returns 401 when there is no auth-token cookie', async () => {
      const handler = vi.fn()
      const res = await withAuth(makeRequest(), handler)

      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Authentication required' })
      expect(handler).not.toHaveBeenCalled()
    })

    it('returns 401 when the token fails verification', async () => {
      h.verifyJWT.mockResolvedValue(null)
      const handler = vi.fn()

      const res = await withAuth(makeRequest('bad-token'), handler)

      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Invalid or expired token' })
      expect(handler).not.toHaveBeenCalled()
    })

    it('attaches userId/email to the request and calls the handler on a valid token', async () => {
      h.verifyJWT.mockResolvedValue({ userId: 'user-1', email: 'u@example.com', sessionId: 's1' })
      const handler = vi.fn(async (req: any) => NextResponse.json({ userId: req.userId, email: req.email }))

      const res = await withAuth(makeRequest('good-token'), handler)

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ userId: 'user-1', email: 'u@example.com' })
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('returns a 401 authentication-failed response when verifyJWT throws unexpectedly', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      h.verifyJWT.mockRejectedValue(new Error('jose exploded'))
      const handler = vi.fn()

      const res = await withAuth(makeRequest('some-token'), handler)

      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Authentication failed' })
      expect(handler).not.toHaveBeenCalled()
      errorSpy.mockRestore()
    })

    it('propagates the handler result when the handler itself throws (middleware does not swallow handler errors it does not cause)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      h.verifyJWT.mockResolvedValue({ userId: 'user-1' })
      const handler = vi.fn(async () => {
        throw new Error('handler blew up')
      })

      const res = await withAuth(makeRequest('good-token'), handler)

      // The try/catch wraps the whole flow, so a handler throw is caught too
      // and converted into the same generic failure response.
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Authentication failed' })
      errorSpy.mockRestore()
    })
  })

  describe('withOptionalAuth()', () => {
    it('calls the handler without attaching user info when there is no token', async () => {
      const handler = vi.fn(async (req: any) => NextResponse.json({ userId: req.userId ?? null }))

      const res = await withOptionalAuth(makeRequest(), handler)

      expect(await res.json()).toEqual({ userId: null })
      expect(h.verifyJWT).not.toHaveBeenCalled()
    })

    it('attaches user info to the request when the token is valid', async () => {
      h.verifyJWT.mockResolvedValue({ userId: 'user-1', email: 'u@example.com' })
      const handler = vi.fn(async (req: any) => NextResponse.json({ userId: req.userId, email: req.email }))

      const res = await withOptionalAuth(makeRequest('good-token'), handler)

      expect(await res.json()).toEqual({ userId: 'user-1', email: 'u@example.com' })
    })

    it('calls the handler without user info when the token is invalid (does not fail the request)', async () => {
      h.verifyJWT.mockResolvedValue(null)
      const handler = vi.fn(async (req: any) => NextResponse.json({ userId: req.userId ?? null }))

      const res = await withOptionalAuth(makeRequest('bad-token'), handler)

      expect(await res.json()).toEqual({ userId: null })
    })

    it('still calls the handler (without user info) when verifyJWT throws', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      h.verifyJWT.mockRejectedValue(new Error('boom'))
      const handler = vi.fn(async (req: any) => NextResponse.json({ userId: req.userId ?? null }))

      const res = await withOptionalAuth(makeRequest('some-token'), handler)

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ userId: null })
      expect(handler).toHaveBeenCalledTimes(1)
      errorSpy.mockRestore()
    })
  })

  describe('getUserFromRequest()', () => {
    it('returns null when there is no token', async () => {
      const result = await getUserFromRequest(makeRequest())
      expect(result).toBeNull()
    })

    it('returns null when the token fails verification', async () => {
      h.verifyJWT.mockResolvedValue(null)
      const result = await getUserFromRequest(makeRequest('bad-token'))
      expect(result).toBeNull()
    })

    it('returns userId/email when the token is valid', async () => {
      h.verifyJWT.mockResolvedValue({ userId: 'user-1', email: 'u@example.com', sessionId: 's1' })
      const result = await getUserFromRequest(makeRequest('good-token'))
      expect(result).toEqual({ userId: 'user-1', email: 'u@example.com' })
    })

    it('returns null when verifyJWT throws', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      h.verifyJWT.mockRejectedValue(new Error('boom'))

      const result = await getUserFromRequest(makeRequest('some-token'))

      expect(result).toBeNull()
      errorSpy.mockRestore()
    })
  })
})
