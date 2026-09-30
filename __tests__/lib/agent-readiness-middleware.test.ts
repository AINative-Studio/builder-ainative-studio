import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * AX/agent-readiness scan (2026-09-30) — two real gaps in middleware.ts:
 *
 *  1. A genuinely nonexistent path 307-redirected to /login (the unmatched-
 *     path fallback treated "unknown" as "protected"), which to a human
 *     looked like a login wall instead of "page not found," and to an agent
 *     probing for resources made it look like every path on the domain
 *     existed (since /login itself returns 200). Confirmed live via
 *     `curl -H 'Accept: text/markdown' .../some-path-that-does-not-exist`.
 *  2. The homepage and unknown paths never served a Markdown representation
 *     even when explicitly requested via `Accept: text/markdown`.
 */

vi.hoisted(() => {
  process.env.AUTH_SECRET = 'test-secret'
})

vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => null) }))

import { middleware } from '@/middleware'

function req(path: string, accept?: string): any {
  const url = new URL(`https://builder.ainative.studio${path}`)
  return {
    nextUrl: Object.assign(url, { clone: () => new URL(url.toString()) }),
    url: url.toString(),
    headers: {
      get: (k: string) => {
        const key = k.toLowerCase()
        if (key === 'host') return 'builder.ainative.studio'
        if (key === 'accept') return accept ?? null
        return null
      },
    },
    method: 'GET',
  }
}

describe('middleware — unknown-path fallback no longer redirects to /login', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.clearAllMocks())

  it('a genuinely nonexistent path is not redirected to /login', async () => {
    const res = await middleware(req('/some-path-that-does-not-exist'))
    expect(res.status).not.toBe(307)
    expect(res.headers.get('location')).toBeNull()
  })

  it('an explicitly protected path is still gated (no over-broad regression)', async () => {
    const res = await middleware(req('/chats'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
  })

  it('/admin is still gated', async () => {
    const res = await middleware(req('/admin'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
  })
})

describe('middleware — Markdown content negotiation', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.clearAllMocks())

  it('the homepage serves real Markdown with Vary: Accept when asked for it', async () => {
    const res = await middleware(req('/', 'text/markdown'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    expect(res.headers.get('vary')).toContain('Accept')
    const body = await res.text()
    expect(body.startsWith('# ')).toBe(true)
  })

  it('the homepage is unaffected (passes through normally) for a plain HTML request', async () => {
    const res = await middleware(req('/', 'text/html'))
    // A plain pass-through has no content-type of its own (Next.js renders the
    // real page downstream) — the real regression this guards against is the
    // negotiation branch firing and injecting a Markdown content-type here.
    expect(res.headers.get('content-type')).not.toBe('text/markdown; charset=utf-8')
  })

  it('a genuinely unknown path returns a real 404 with a Markdown body when Markdown is requested', async () => {
    const res = await middleware(req('/this-does-not-exist', 'text/markdown'))
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    expect(res.headers.get('vary')).toContain('Accept')
    const body = await res.text()
    expect(body).toContain('/this-does-not-exist')
  })

  it('a real, known route is never given the Markdown-404 treatment even when Markdown is requested', async () => {
    const res = await middleware(req('/pricing', 'text/markdown'))
    expect(res.status).not.toBe(404)
  })
})
