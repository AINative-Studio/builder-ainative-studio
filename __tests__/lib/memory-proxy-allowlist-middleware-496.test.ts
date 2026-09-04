import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #496 — /api/memory/* must be middleware-allowlisted.
 *
 * The ZeroMemory proxy self-authenticates exactly like /api/db/*: the same
 * signed per-app data token, verified inside the route handler. A generated
 * app has no next-auth session at all — caught live during this same fix
 * (the route itself worked once tested directly, but the middleware's
 * session gate would 401 every real request before the route's own auth
 * ever ran, exactly like the #443 primitive-proxy gap this mirrors).
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://builder.ainative.studio'
  process.env.AUTH_SECRET = 'test-secret'
})

vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: vi.fn(async () => null),
}))
// No session — the whole point: a generated app calling its own memory
// proxy has no session cookie at all.
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => null) }))
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(async () => ({ success: true, response: null })),
}))

import { middleware } from '@/middleware'

function apiReq(path: string): any {
  const host = 'builder.ainative.studio'
  const url = new URL(`https://${host}${path}`)
  return {
    nextUrl: Object.assign(url, { clone: () => new URL(url.toString()) }),
    url: url.toString(),
    headers: { get: (k: string) => (k.toLowerCase() === 'host' ? host : null) },
    method: 'POST',
  }
}

describe('middleware /api/memory allowlist (#496)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.clearAllMocks())

  it('does NOT 401 a tokenless /api/memory/remember request (passes through to the route\'s own auth)', async () => {
    const res = await middleware(apiReq('/api/memory/remember'))
    expect(res.status).not.toBe(401)
  })

  it('does NOT 401 a tokenless /api/memory/recall request', async () => {
    const res = await middleware(apiReq('/api/memory/recall'))
    expect(res.status).not.toBe(401)
  })

  it('STILL 401s a non-allowlisted /api/* route with no session', async () => {
    const res = await middleware(apiReq('/api/some-protected-route'))
    expect(res.status).toBe(401)
  })
})
