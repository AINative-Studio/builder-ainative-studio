import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #344 (audit dormant finding #9) — /api/cron/* must be middleware-allowlisted.
 *
 * Cron endpoints are called by a scheduler and self-authenticate with
 * `Authorization: Bearer $CRON_SECRET` inside the handler. The middleware
 * session gate was 401'ing them BEFORE that secret check could run, so no
 * scheduled job (winback email, nightly loop, alerts) could ever fire.
 *
 * These lock the fix: with NO session token, an /api/cron/* request must pass
 * through (NextResponse.next()), while a non-allowlisted /api/* request must
 * still be rejected 401.
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://builder.ainative.studio'
  process.env.AUTH_SECRET = 'test-secret'
})

// No wildcard host → the subdomain gate is skipped and control reaches the API
// auth gate, which is what we're testing.
vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: vi.fn(async () => null),
}))
// No session — this is the whole point: a tokenless cron call must NOT 401.
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => null) }))
// Rate limiter must resolve success so it never short-circuits the path.
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

describe('middleware /api/cron allowlist (#344)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.clearAllMocks())

  it('does NOT 401 a tokenless /api/cron/alerts request (passes through)', async () => {
    const res = await middleware(apiReq('/api/cron/alerts'))
    // NextResponse.next() has no 401 status; a rejection would be status 401.
    expect(res.status).not.toBe(401)
  })

  it('does NOT 401 any /api/cron/* subpath', async () => {
    const res = await middleware(apiReq('/api/cron/winback'))
    expect(res.status).not.toBe(401)
  })

  it('STILL 401s a non-allowlisted /api/* route with no session', async () => {
    const res = await middleware(apiReq('/api/some-protected-route'))
    expect(res.status).toBe(401)
  })
})
