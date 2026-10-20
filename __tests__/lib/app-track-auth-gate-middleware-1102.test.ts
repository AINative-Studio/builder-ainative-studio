import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1102/#1113 — /build/{slug} auth gate for track:'app' entries.
 *
 * Root cause (confirmed live): /build/{slug} is meant to be a company's real
 * shareable PUBLIC url (#207), but that promise only holds for
 * `track: 'company'` entries — those always go through a dedicated 'landing'
 * generation step (COMPANY_VIEWS). `track: 'app'` entries have no landing
 * step at all (APP_VIEWS) — they're internal tools, and exposing one
 * publicly just surfaces whatever internal UI the app happens to have
 * (confirmed live: habanero-hub's order-management dashboard, tidemark's
 * community feed — both real, working, neither a marketing page). Product
 * decision: gate app-track's /build/{slug} behind the same auth wall every
 * other non-public screen already uses.
 *
 * No AINATIVE_WILDCARD_HOST set here — requests hit builder.ainative.studio
 * directly (no wildcard-subdomain rewrite), so this test only exercises the
 * new app-track gate logic, same isolation approach as
 * subdomain-gate-middleware.test.ts uses for the wildcard gate.
 */

vi.hoisted(() => {
  process.env.AUTH_SECRET = 'test-secret'
  delete process.env.AINATIVE_WILDCARD_HOST
})

const resolveAppMock = vi.fn()
vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: (...args: unknown[]) => resolveAppMock(...args),
}))

const getTokenMock = vi.fn()
vi.mock('next-auth/jwt', () => ({ getToken: (...args: unknown[]) => getTokenMock(...args) }))

import { middleware } from '@/middleware'

function req(path: string): any {
  const url = new URL(`https://builder.ainative.studio${path}`)
  return {
    nextUrl: Object.assign(url, { clone: () => new URL(url.toString()) }),
    url: url.toString(),
    headers: { get: (k: string) => (k.toLowerCase() === 'host' ? 'builder.ainative.studio' : null) },
    method: 'GET',
  }
}

describe('middleware app-track auth gate (#1102/#1113)', () => {
  beforeEach(() => {
    resolveAppMock.mockReset()
    getTokenMock.mockReset()
  })
  afterEach(() => vi.clearAllMocks())

  it('track:"app", no session → redirects to /login', async () => {
    resolveAppMock.mockResolvedValueOnce({ slug: 'habanero-hub', chatId: 'c1', track: 'app' })
    getTokenMock.mockResolvedValueOnce(null)
    const res = await middleware(req('/build/habanero-hub'))
    expect(res.status).toBe(307) // NextResponse.redirect default
    expect(res.headers.get('location')).toBe('https://builder.ainative.studio/login')
  })

  it('track:"app", valid session → passes through (no redirect)', async () => {
    resolveAppMock.mockResolvedValueOnce({ slug: 'habanero-hub', chatId: 'c1', track: 'app' })
    getTokenMock.mockResolvedValueOnce({ sub: 'user-1', email: 'founder@example.com' })
    const res = await middleware(req('/build/habanero-hub'))
    expect(res.status).not.toBe(307)
    expect(res.headers.get('location')).toBeNull()
  })

  it('track:"company" → never auth-gated, even with no session', async () => {
    resolveAppMock.mockResolvedValueOnce({ slug: 'groundwork', chatId: 'c1', track: 'company' })
    getTokenMock.mockResolvedValueOnce(null)
    const res = await middleware(req('/build/groundwork'))
    expect(res.status).not.toBe(307)
    expect(res.headers.get('location')).toBeNull()
  })

  it('unregistered slug (null entry) → never auth-gated (not this gate\'s job to 404)', async () => {
    resolveAppMock.mockResolvedValueOnce(null)
    const res = await middleware(req('/build/unknownco'))
    expect(res.status).not.toBe(307)
  })

  it('a resolveApp lookup error fails OPEN (never 401s a real shareable link on an outage)', async () => {
    resolveAppMock.mockRejectedValueOnce(new Error('ZeroDB unreachable'))
    const res = await middleware(req('/build/habanero-hub'))
    expect(res.status).not.toBe(307)
    expect(getTokenMock).not.toHaveBeenCalled()
  })

  it('/build itself (the dashboard, no slug) is never gated by this check', async () => {
    const res = await middleware(req('/build'))
    expect(resolveAppMock).not.toHaveBeenCalled()
    expect(res.status).not.toBe(307)
  })

  it('/build/{slug}/sitemap.xml (a deeper path) is never matched by the single-segment gate', async () => {
    const res = await middleware(req('/build/habanero-hub/sitemap.xml'))
    expect(resolveAppMock).not.toHaveBeenCalled()
  })

  it('known static /build subpaths (mcp, gtm, prd-generator, strapi) are never matched', async () => {
    for (const p of ['/build/mcp/foo', '/build/gtm/bar', '/build/prd-generator/baz', '/build/strapi/qux']) {
      resolveAppMock.mockReset()
      const res = await middleware(req(p))
      expect(resolveAppMock).not.toHaveBeenCalled()
      expect(res.status).not.toBe(307)
    }
  })
})
