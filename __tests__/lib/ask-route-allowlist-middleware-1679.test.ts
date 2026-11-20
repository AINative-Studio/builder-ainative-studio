import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1679 — /api/ask must be middleware-allowlisted.
 *
 * /api/ask is a thin forward to the already-public /api/build/help handler
 * (NLWeb-convention discovery alias). It has no auth of its own — it lives
 * outside the /api/build/ prefix, so the session gate was 401'ing every
 * request before it ever reached the handler.
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://builder.ainative.studio'
  process.env.AUTH_SECRET = 'test-secret'
})

vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: vi.fn(async () => null),
}))
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => null) }))
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(async () => ({ success: true, response: null })),
}))

import { middleware } from '@/middleware'

function apiReq(path: string, method = 'GET'): any {
  const host = 'builder.ainative.studio'
  const url = new URL(`https://${host}${path}`)
  return {
    nextUrl: Object.assign(url, { clone: () => new URL(url.toString()) }),
    url: url.toString(),
    headers: { get: (k: string) => (k.toLowerCase() === 'host' ? host : null) },
    method,
  }
}

describe('middleware /api/ask allowlist (#1679)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.clearAllMocks())

  it('does NOT 401 a tokenless POST /api/ask request', async () => {
    const res = await middleware(apiReq('/api/ask', 'POST'))
    expect(res.status).not.toBe(401)
  })

  it('STILL 401s a non-allowlisted /api/* route with no session', async () => {
    const res = await middleware(apiReq('/api/some-protected-route'))
    expect(res.status).toBe(401)
  })

  // #2170 — /ask (root path, NLWeb convention) is not under /api/ at all, so
  // it never goes through the session-gate branch above in the first place.
  // Confirms it isn't accidentally caught by protectedPaths or redirected to
  // /login the way a genuinely-unknown top-level path used to be.
  it('does NOT redirect a tokenless GET /ask to /login', async () => {
    const res = await middleware(apiReq('/ask?query=hello', 'GET'))
    expect(res.status).not.toBe(401)
    const location = res.headers.get('location')
    expect(location === null || !location.includes('/login')).toBe(true)
  })
})
