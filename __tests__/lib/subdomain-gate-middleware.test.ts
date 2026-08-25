import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #78 — middleware wildcard-rewrite gate integration. A request to
 * {slug}.ainative.studio must:
 *   • unpaid / unclaimed  → 301 redirect to /build/{slug} (never serve the subdomain)
 *   • paid + claimed      → rewrite to /build/{slug} (serve the app on the subdomain)
 *   • lookup ERROR        → fail-safe 301 redirect to /build/{slug}
 *
 * We stub the wildcard host env + resolveApp so the test is pure and offline. next-auth
 * and rate-limit are only reached AFTER the wildcard block, so they never run here.
 */

vi.hoisted(() => {
  process.env.AINATIVE_WILDCARD_HOST = 'ainative.studio'
  process.env.NEXT_PUBLIC_APP_URL = 'https://builder.ainative.studio'
  process.env.AUTH_SECRET = 'test-secret'
})

// Mock the app-registry lookup the gate depends on. subdomainServable + the
// wildcard slug extraction remain the REAL implementations under test.
const resolveAppMock = vi.fn()
vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: (...args: unknown[]) => resolveAppMock(...args),
}))
// next-auth getToken is never reached in these cases, but must resolve if it were.
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => null) }))

import { middleware } from '@/middleware'

function req(host: string, path = '/'): any {
  const url = new URL(`https://${host}${path}`)
  return {
    nextUrl: Object.assign(url, { clone: () => new URL(url.toString()) }),
    url: url.toString(),
    headers: { get: (k: string) => (k.toLowerCase() === 'host' ? host : null) },
    method: 'GET',
  }
}

describe('middleware subdomain gate (#78)', () => {
  beforeEach(() => resolveAppMock.mockReset())
  afterEach(() => vi.clearAllMocks())

  it('unpaid slug → 301 redirect to /build/{slug}', async () => {
    resolveAppMock.mockResolvedValueOnce({ slug: 'quad', chatId: 'c1', plan: '', subdomainClaimed: false })
    const res = await middleware(req('quad.ainative.studio', '/'))
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('https://builder.ainative.studio/build/quad')
  })

  it('paid but NOT claimed → 301 redirect to /build/{slug}', async () => {
    resolveAppMock.mockResolvedValueOnce({ slug: 'quad', chatId: 'c1', plan: 'pro', subdomainClaimed: false })
    const res = await middleware(req('quad.ainative.studio', '/'))
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('https://builder.ainative.studio/build/quad')
  })

  it('paid + claimed → rewrites to /build/{slug} (serves the subdomain)', async () => {
    resolveAppMock.mockResolvedValueOnce({ slug: 'acme', chatId: 'c1', plan: 'pro', subdomainClaimed: true })
    const res = await middleware(req('acme.ainative.studio', '/'))
    // NextResponse.rewrite is not a redirect — no 3xx location; the rewrite target is
    // carried in the x-middleware-rewrite header.
    expect(res.status).not.toBe(301)
    expect(res.headers.get('x-middleware-rewrite')).toContain('/build/acme')
  })

  it('paid + claimed with a subpath → rewrites carrying the subpath', async () => {
    resolveAppMock.mockResolvedValueOnce({ slug: 'acme', chatId: 'c1', plan: 'enterprise', subdomainClaimed: true })
    const res = await middleware(req('acme.ainative.studio', '/pricing'))
    expect(res.headers.get('x-middleware-rewrite')).toContain('/build/acme/pricing')
  })

  it('fail-safe: a lookup error → 301 redirect to /build/{slug} (never serves)', async () => {
    resolveAppMock.mockRejectedValueOnce(new Error('ZeroDB unreachable'))
    const res = await middleware(req('quad.ainative.studio', '/'))
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('https://builder.ainative.studio/build/quad')
  })

  it('unregistered slug (null entry) → 301 redirect to /build/{slug}', async () => {
    resolveAppMock.mockResolvedValueOnce(null)
    const res = await middleware(req('unknownco.ainative.studio', '/'))
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('https://builder.ainative.studio/build/unknownco')
  })
})
