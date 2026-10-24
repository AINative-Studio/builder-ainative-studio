import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1465 — authenticateWithAINative() used to collapse wrong credentials, a
 * non-OK/5xx AINative backend response, a thrown network error, and a
 * malformed profile response into an identical `return null`, which
 * authorize() then either fell through to local-DB auth or let next-auth
 * turn into a generic CredentialsSignin. A real AINative backend outage
 * blocking every login looked exactly like one user mistyping a password.
 *
 * These tests exercise the real authorize() function from app/(auth)/auth.ts
 * (captured off the real NextAuth(config) call via a mocked 'next-auth'
 * module — the real module can't be imported directly in vitest's node
 * environment; next-auth/lib/env.js does a bare `from "next/server"` import
 * that Node's ESM resolver can't satisfy under this pnpm layout, unrelated to
 * this fix and reproducible on main). Mocking 'next-auth' itself sidesteps
 * that broken transitive import while still running the real authorize/
 * authenticateWithAINative code bodies.
 */

vi.mock('@/lib/db/queries', () => ({
  createGuestUser: vi.fn(),
  getUser: vi.fn(async () => []),
}))
vi.mock('@/lib/auth/tokenRefresh', () => ({
  shouldRefreshToken: vi.fn(() => false),
  refreshAINativeToken: vi.fn(),
}))
vi.mock('@/lib/auth/phone-login', () => ({ authorizePhoneLogin: vi.fn() }))

const alertMock = vi.fn(async () => {})
vi.mock('@/lib/jobs/alerting', () => ({
  checkAINativeAuthOutageAlert: alertMock,
}))

const capturedConfig = { current: null as any }

vi.mock('next-auth', () => {
  class AuthError extends Error {
    type: string
    constructor(message?: string, errorOptions?: unknown) {
      super(message)
      this.type = (this.constructor as any).type ?? 'AuthError'
      this.name = this.constructor.name
      void errorOptions
    }
  }
  return {
    default: (config: any) => {
      capturedConfig.current = config
      return {
        handlers: { GET: vi.fn(), POST: vi.fn() },
        auth: vi.fn(),
        signIn: vi.fn(),
        signOut: vi.fn(),
      }
    },
    AuthError,
  }
})
vi.mock('next-auth/providers/credentials', () => ({ default: (opts: any) => opts }))

async function loadAuthorize() {
  vi.resetModules()
  process.env.AUTH_SECRET = 'test-secret-for-1465'
  process.env.AINATIVE_API_BASE_URL = 'https://api.ainative.studio'
  await import('@/app/(auth)/auth')
  // Credentials({ credentials: {}, async authorize... }) is providers[0] —
  // the password-login provider (see app/(auth)/auth.ts's providers array).
  const provider = capturedConfig.current.providers[0]
  return provider.authorize as (creds: any) => Promise<any>
}

beforeEach(() => {
  alertMock.mockClear()
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('#1465 authorize() / authenticateWithAINative — failure classification', () => {
  it('wrong password (AINative 401) returns null — no alert, falls through to local-DB auth', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ detail: 'Invalid credentials' }) })),
    )
    const authorize = await loadAuthorize()

    const result = await authorize({ email: 'founder@example.com', password: 'wrong-password' })

    expect(result).toBeNull()
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('AINative backend 500 throws a distinct error and fires the outage alert', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    )
    const authorize = await loadAuthorize()

    await expect(
      authorize({ email: 'founder@example.com', password: 'correct-password' }),
    ).rejects.toMatchObject({ type: 'AINativeBackendUnavailable' })
    expect(alertMock).toHaveBeenCalledTimes(1)
  })

  it('a thrown network error (fetch rejects) throws the same distinct error and fires the alert', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )
    const authorize = await loadAuthorize()

    await expect(
      authorize({ email: 'founder@example.com', password: 'correct-password' }),
    ).rejects.toMatchObject({ type: 'AINativeBackendUnavailable' })
    expect(alertMock).toHaveBeenCalledTimes(1)
  })

  it('a malformed profile response (missing access_token) throws the distinct error and fires the alert', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/v1/auth/login')) {
          return { ok: true, json: async () => ({}) } // no access_token
        }
        return { ok: true, json: async () => ({}) }
      }),
    )
    const authorize = await loadAuthorize()

    await expect(
      authorize({ email: 'founder@example.com', password: 'correct-password' }),
    ).rejects.toMatchObject({ type: 'AINativeBackendUnavailable' })
    expect(alertMock).toHaveBeenCalledTimes(1)
  })

  it('a malformed profile response (profile fetch itself fails) throws the distinct error and fires the alert', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/v1/auth/login')) {
          return { ok: true, json: async () => ({ access_token: 'tok-123' }) }
        }
        if (String(url).includes('/v1/auth/me')) {
          return { ok: false, status: 503, json: async () => ({}) }
        }
        return { ok: true, json: async () => ({}) }
      }),
    )
    const authorize = await loadAuthorize()

    await expect(
      authorize({ email: 'founder@example.com', password: 'correct-password' }),
    ).rejects.toMatchObject({ type: 'AINativeBackendUnavailable' })
    expect(alertMock).toHaveBeenCalledTimes(1)
  })

  it('a malformed JSON body (response.json() throws) throws the distinct error and fires the alert', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token in JSON')
        },
      })),
    )
    const authorize = await loadAuthorize()

    await expect(
      authorize({ email: 'founder@example.com', password: 'correct-password' }),
    ).rejects.toMatchObject({ type: 'AINativeBackendUnavailable' })
    expect(alertMock).toHaveBeenCalledTimes(1)
  })

  it('never logs the password in either the outage or the wrong-credentials path', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const password = 'super-secret-do-not-log-1465'

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )
    const authorize = await loadAuthorize()
    await authorize({ email: 'founder@example.com', password }).catch(() => {})

    const allLoggedText = [...consoleSpy.mock.calls, ...consoleLogSpy.mock.calls]
      .flat()
      .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
      .join(' ')
    expect(allLoggedText).not.toContain(password)

    consoleSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })

  it('a successful AINative login still returns the resolved user (control case, unaffected by the fix)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url)
        if (u.includes('/v1/auth/login')) {
          return { ok: true, json: async () => ({ access_token: 'tok-abc', refresh_token: 'rt-abc', expires_in: 3600 }) }
        }
        if (u.includes('/v1/auth/me')) {
          return { ok: true, json: async () => ({ id: 'u1', email: 'founder@example.com', username: 'founder' }) }
        }
        if (u.includes('/api/v1/workspaces')) {
          return { ok: true, json: async () => ({ workspaces: [] }) }
        }
        return { ok: true, json: async () => ({}) }
      }),
    )
    const authorize = await loadAuthorize()

    const result = await authorize({ email: 'founder@example.com', password: 'correct-password' })

    expect(result).toMatchObject({ id: 'u1', email: 'founder@example.com', type: 'ainative' })
    expect(alertMock).not.toHaveBeenCalled()
  })
})
