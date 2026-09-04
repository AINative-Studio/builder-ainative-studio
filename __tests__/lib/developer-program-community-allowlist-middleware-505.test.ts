import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #505 — /api/developer-program/* and /api/community/* must be
 * middleware-allowlisted.
 *
 * Both proxies self-authenticate exactly like /api/memory/* and /api/db/*:
 * the same signed per-app data token, verified inside the route handler. A
 * generated app has no next-auth session at all.
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

function apiReq(path: string): any {
  const host = 'builder.ainative.studio'
  const url = new URL(`https://${host}${path}`)
  return {
    nextUrl: Object.assign(url, { clone: () => new URL(url.toString()) }),
    url: url.toString(),
    headers: { get: (k: string) => (k.toLowerCase() === 'host' ? host : null) },
    method: 'GET',
  }
}

describe('middleware /api/developer-program and /api/community allowlist (#505)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.clearAllMocks())

  it('does NOT 401 a tokenless /api/developer-program/analytics request', async () => {
    const res = await middleware(apiReq('/api/developer-program/analytics'))
    expect(res.status).not.toBe(401)
  })

  it('does NOT 401 a tokenless /api/developer-program/logs request', async () => {
    const res = await middleware(apiReq('/api/developer-program/logs'))
    expect(res.status).not.toBe(401)
  })

  it('does NOT 401 a tokenless /api/community/members request', async () => {
    const res = await middleware(apiReq('/api/community/members'))
    expect(res.status).not.toBe(401)
  })

  it('STILL 401s a non-allowlisted /api/* route with no session', async () => {
    const res = await middleware(apiReq('/api/some-protected-route'))
    expect(res.status).toBe(401)
  })
})
