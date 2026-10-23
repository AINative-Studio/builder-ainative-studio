import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  createUserSession: vi.fn(),
  validateSession: vi.fn(),
  invalidateSession: vi.fn(),
  signJWT: vi.fn(),
  jwtVerify: vi.fn(),
}))

vi.mock('@/lib/session-manager', () => ({
  createUserSession: h.createUserSession,
  validateSession: h.validateSession,
  invalidateSession: h.invalidateSession,
}))

// jose's SignJWT is a fluent builder; stub a minimal chain that captures the
// payload and resolves to a deterministic fake token string.
vi.mock('jose', () => {
  class FakeSignJWT {
    private payload: Record<string, unknown>
    constructor(payload: Record<string, unknown>) {
      this.payload = payload
    }
    setProtectedHeader() {
      return this
    }
    setIssuedAt() {
      return this
    }
    setExpirationTime() {
      return this
    }
    async sign() {
      return h.signJWT(this.payload)
    }
  }
  return {
    SignJWT: FakeSignJWT,
    jwtVerify: h.jwtVerify,
  }
})

const ORIGINAL_ENV = { ...process.env }

async function freshModule() {
  vi.resetModules()
  return await import('@/lib/auth-jwt')
}

describe('lib/auth-jwt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...ORIGINAL_ENV }
    h.signJWT.mockImplementation((payload) => `fake-token:${JSON.stringify(payload)}`)
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  describe('generateJWT()', () => {
    it('creates a session and returns a token plus sessionId', async () => {
      h.createUserSession.mockResolvedValue({ sessionId: 'sess-1', expiresAt: new Date() })

      const { generateJWT } = await freshModule()
      const result = await generateJWT('user-1', 'user1@example.com')

      expect(h.createUserSession).toHaveBeenCalledWith('user-1', 'user1@example.com')
      expect(result.sessionId).toBe('sess-1')
      expect(result.token).toContain('sess-1')
      expect(result.token).toContain('user-1')
    })

    it('generates a token without requiring an email', async () => {
      h.createUserSession.mockResolvedValue({ sessionId: 'sess-2', expiresAt: new Date() })

      const { generateJWT } = await freshModule()
      const result = await generateJWT('user-2')

      expect(result.sessionId).toBe('sess-2')
    })

    it('propagates an error when session creation fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      h.createUserSession.mockRejectedValue(new Error('db unavailable'))

      const { generateJWT } = await freshModule()

      await expect(generateJWT('user-1')).rejects.toThrow('db unavailable')
      errorSpy.mockRestore()
    })
  })

  describe('verifyJWT()', () => {
    it('returns the payload when the token is valid and the session still exists', async () => {
      h.jwtVerify.mockResolvedValue({
        payload: { userId: 'user-1', email: 'u@example.com', sessionId: 'sess-1' },
      })
      h.validateSession.mockResolvedValue('user-1')

      const { verifyJWT } = await freshModule()
      const result = await verifyJWT('some-token')

      expect(result).toEqual({ userId: 'user-1', email: 'u@example.com', sessionId: 'sess-1' })
      expect(h.validateSession).toHaveBeenCalledWith('sess-1')
    })

    it('returns null when the session no longer exists (even though the JWT itself verifies)', async () => {
      h.jwtVerify.mockResolvedValue({ payload: { userId: 'user-1', sessionId: 'sess-dead' } })
      h.validateSession.mockResolvedValue(null)

      const { verifyJWT } = await freshModule()
      const result = await verifyJWT('some-token')

      expect(result).toBeNull()
    })

    it('returns null when jwtVerify throws (invalid signature/expired token)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      h.jwtVerify.mockRejectedValue(new Error('signature verification failed'))

      const { verifyJWT } = await freshModule()
      const result = await verifyJWT('bad-token')

      expect(result).toBeNull()
      errorSpy.mockRestore()
    })
  })

  describe('invalidateJWT()', () => {
    it('invalidates the session tied to the token', async () => {
      h.jwtVerify.mockResolvedValue({ payload: { sessionId: 'sess-1' } })

      const { invalidateJWT } = await freshModule()
      await invalidateJWT('some-token')

      expect(h.invalidateSession).toHaveBeenCalledWith('sess-1')
    })

    it('throws when the token cannot be verified', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      h.jwtVerify.mockRejectedValue(new Error('bad token'))

      const { invalidateJWT } = await freshModule()

      await expect(invalidateJWT('bad-token')).rejects.toThrow('bad token')
      errorSpy.mockRestore()
    })
  })

  describe('refreshJWT()', () => {
    it('returns a new token with the same session when the current token is valid', async () => {
      h.jwtVerify.mockResolvedValue({
        payload: { userId: 'user-1', email: 'u@example.com', sessionId: 'sess-1' },
      })
      h.validateSession.mockResolvedValue('user-1')

      const { refreshJWT } = await freshModule()
      const newToken = await refreshJWT('old-token')

      expect(newToken).toContain('sess-1')
      expect(newToken).toContain('user-1')
    })

    it('returns null when the current token fails verification', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      h.jwtVerify.mockRejectedValue(new Error('expired'))

      const { refreshJWT } = await freshModule()
      const result = await refreshJWT('expired-token')

      expect(result).toBeNull()
      errorSpy.mockRestore()
    })

    it('returns null when the session backing the token has been invalidated', async () => {
      h.jwtVerify.mockResolvedValue({ payload: { userId: 'user-1', sessionId: 'sess-gone' } })
      h.validateSession.mockResolvedValue(null)

      const { refreshJWT } = await freshModule()
      const result = await refreshJWT('stale-token')

      expect(result).toBeNull()
    })

    it('returns null when signing the replacement token itself throws', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      h.jwtVerify.mockResolvedValue({ payload: { userId: 'user-1', sessionId: 'sess-1' } })
      h.validateSession.mockResolvedValue('user-1')
      h.signJWT.mockImplementation(() => {
        throw new Error('signing key unavailable')
      })

      const { refreshJWT } = await freshModule()
      const result = await refreshJWT('old-token')

      expect(result).toBeNull()
      expect(errorSpy).toHaveBeenCalledWith('Failed to refresh JWT:', expect.any(Error))
      errorSpy.mockRestore()
    })
  })
})
