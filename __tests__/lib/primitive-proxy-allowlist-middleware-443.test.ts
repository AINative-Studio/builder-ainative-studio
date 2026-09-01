import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #443 — /api/primitive/* must be middleware-allowlisted.
 *
 * The runtime proxy self-authenticates exactly like /api/db/*: a deployed
 * company reads COMPANY_SLUG from its own env, the shared preview iframe
 * presents a signed per-app primitive-proxy token. Neither carries a
 * next-auth session — a generated app has no session at all — so without
 * this allowlist entry, the middleware's session gate 401'd every request
 * before the route's own auth resolution ever ran (caught live in
 * production right after #445 first deployed; this closes that gap).
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://builder.ainative.studio'
  process.env.AUTH_SECRET = 'test-secret'
})

vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: vi.fn(async () => null),
}))
// No session — the whole point: a generated app calling its own primitive
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
    method: 'GET',
  }
}

describe('middleware /api/primitive allowlist (#443)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.clearAllMocks())

  it('does NOT 401 a tokenless /api/primitive/zerocommerce/... request (passes through)', async () => {
    const res = await middleware(apiReq('/api/primitive/zerocommerce/commerce/products'))
    expect(res.status).not.toBe(401)
  })

  it('does NOT 401 any /api/primitive/* subpath', async () => {
    const res = await middleware(apiReq('/api/primitive/zeropipeline/pipelines'))
    expect(res.status).not.toBe(401)
  })

  it('STILL 401s a non-allowlisted /api/* route with no session', async () => {
    const res = await middleware(apiReq('/api/some-protected-route'))
    expect(res.status).toBe(401)
  })
})
