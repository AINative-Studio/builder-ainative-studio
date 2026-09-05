import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #515 — /docs/components is listed in app/sitemap.ts (submitted to search
 * engines) but middleware.ts has no allowlist rule for /docs/*, so anonymous
 * requests fall through to the default-deny branch and 307-redirect to
 * /login. Confirmed live: curl -sI https://builder.ainative.studio/docs/components
 * → 307 → location: /login. Same class of bug already fixed for /templates
 * and /guides ("MUST be crawlable/indexable without an account").
 */

vi.hoisted(() => {
  process.env.AUTH_SECRET = 'test-secret'
})

vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => null) }))

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

describe('middleware /docs crawlability gate (#515)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.clearAllMocks())

  it('/docs/components is served to anonymous visitors, not redirected to /login', async () => {
    const res = await middleware(req('/docs/components'))
    expect(res.status).not.toBe(307)
    expect(res.headers.get('location')).toBeNull()
  })

  it('/docs index is also served to anonymous visitors', async () => {
    const res = await middleware(req('/docs'))
    expect(res.status).not.toBe(307)
    expect(res.headers.get('location')).toBeNull()
  })

  it('protected routes are still gated (no over-broad allowlist regression)', async () => {
    const res = await middleware(req('/chats'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
  })
})
