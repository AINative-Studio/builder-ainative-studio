import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * /api/ainative-ngo/* must be middleware-allowlisted.
 *
 * The AINativeNGO proxy self-authenticates exactly like /api/memory/* and
 * /api/db/*: the same signed per-app data token, verified inside the route
 * handler. A generated app has no next-auth session at all.
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

describe('middleware /api/ainative-ngo allowlist', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.clearAllMocks())

  it('does NOT 401 a tokenless /api/ainative-ngo/institutions request', async () => {
    const res = await middleware(apiReq('/api/ainative-ngo/institutions'))
    expect(res.status).not.toBe(401)
  })

  it('STILL 401s a non-allowlisted /api/* route with no session', async () => {
    const res = await middleware(apiReq('/api/some-protected-route'))
    expect(res.status).toBe(401)
  })
})
