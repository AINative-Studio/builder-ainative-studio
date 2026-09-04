import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #499 — /api/browser-agent/* must be middleware-allowlisted.
 *
 * The Browser Agent proxy self-authenticates exactly like /api/memory/*: the
 * same signed per-app data token, verified inside the route handler. A
 * generated app has no next-auth session at all — same gap #496 hit for
 * /api/memory/ and #443 hit for /api/primitive/.
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://builder.ainative.studio'
  process.env.AUTH_SECRET = 'test-secret'
})

vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: vi.fn(async () => null),
}))
// No session — the whole point: a generated app calling its own browser
// agent proxy has no session cookie at all.
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

describe('middleware /api/browser-agent allowlist (#499)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.clearAllMocks())

  it('does NOT 401 a tokenless /api/browser-agent/extract request (passes through to the route\'s own auth)', async () => {
    const res = await middleware(apiReq('/api/browser-agent/extract'))
    expect(res.status).not.toBe(401)
  })

  it('does NOT 401 a tokenless /api/browser-agent/act request', async () => {
    const res = await middleware(apiReq('/api/browser-agent/act'))
    expect(res.status).not.toBe(401)
  })

  it('STILL 401s a non-allowlisted /api/* route with no session', async () => {
    const res = await middleware(apiReq('/api/some-protected-route'))
    expect(res.status).toBe(401)
  })
})
