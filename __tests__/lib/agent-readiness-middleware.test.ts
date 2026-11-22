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

const resolveAppMock = vi.fn(async (_slug: string): Promise<any> => null)
vi.mock('@/lib/build/app-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/build/app-registry')>()
  return { ...actual, resolveApp: (slug: string) => resolveAppMock(slug) }
})

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
    // #2174/PR #2177 — homepageMarkdown() now opens with a YAML frontmatter
    // block before the top-level heading, so the body no longer starts with
    // "# " directly; it still carries the heading right after the frontmatter.
    expect(body.startsWith('---\n')).toBe(true)
    expect(body).toMatch(/\n# /)
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

describe('middleware — ?mode=agent dedicated agent view (#1680)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.clearAllMocks())

  it('?mode=agent on the homepage serves the same real Markdown summary as Accept: text/markdown', async () => {
    const res = await middleware(req('/?mode=agent'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    const body = await res.text()
    // Same frontmatter-prefixed shape as the Accept: text/markdown case above.
    expect(body.startsWith('---\n')).toBe(true)
    expect(body).toMatch(/\n# /)
  })

  it('a plain homepage request with no mode param and no markdown Accept header passes through unaffected', async () => {
    const res = await middleware(req('/'))
    expect(res.headers.get('content-type')).not.toBe('text/markdown; charset=utf-8')
  })

  it('mode=agent on a non-homepage path does not trigger the homepage Markdown response', async () => {
    const res = await middleware(req('/pricing?mode=agent'))
    expect(res.headers.get('content-type')).not.toBe('text/markdown; charset=utf-8')
  })
})

describe('middleware — /build/{slug} Markdown content negotiation (#2205/#2206)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveAppMock.mockReset()
  })
  afterEach(() => vi.clearAllMocks())

  it('a registered company serves real company Markdown for Accept: text/markdown', async () => {
    resolveAppMock.mockResolvedValue({ chatId: 'c1', name: 'Wrench', tagline: 'From job site to paid.' })
    const res = await middleware(req('/build/wrench', 'text/markdown'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    expect(res.headers.get('vary')).toContain('Accept')
    const body = await res.text()
    expect(body).toContain('Wrench')
    expect(body).toContain('From job site to paid.')
    expect(body).not.toContain('AI that builds AND runs your company')
  })

  it('a registered company serves the same Markdown for ?mode=agent', async () => {
    resolveAppMock.mockResolvedValue({ chatId: 'c1', name: 'Wrench', tagline: 'From job site to paid.' })
    const res = await middleware(req('/build/wrench?mode=agent'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    const body = await res.text()
    expect(body).toContain('Wrench')
  })

  it('an unregistered slug falls through to the real page (no fabricated Markdown)', async () => {
    resolveAppMock.mockResolvedValue(null)
    const res = await middleware(req('/build/does-not-exist', 'text/markdown'))
    expect(res.headers.get('content-type')).not.toBe('text/markdown; charset=utf-8')
  })

  it('a plain HTML request for a company page is unaffected', async () => {
    resolveAppMock.mockResolvedValue({ chatId: 'c1', name: 'Wrench' })
    const res = await middleware(req('/build/wrench', 'text/html'))
    expect(res.headers.get('content-type')).not.toBe('text/markdown; charset=utf-8')
  })

  it('a nested company sub-route (llms.txt) is never intercepted by this branch', async () => {
    resolveAppMock.mockResolvedValue({ chatId: 'c1', name: 'Wrench' })
    const res = await middleware(req('/build/wrench/llms.txt', 'text/markdown'))
    expect(res.headers.get('content-type')).not.toBe('text/markdown; charset=utf-8')
  })
})

/**
 * #2218 — `config.matcher`'s static-asset exclusion list already skipped
 * middleware entirely for .txt/.xml/.json/etc, but NOT .md, even though real
 * static .md files exist (public/SKILL.md, public/auth.md, and the new
 * public/AGENTS.md). Confirmed live before this fix:
 * `curl -H 'Accept: text/markdown' https://builder.ainative.studio/SKILL.md`
 * returned a FABRICATED 404 ("does not exist") via the Markdown-404
 * fallback below, even though the real file serves fine on a plain
 * request — isLikelyUnknownPath has no way to know a public/*.md path is
 * real. The fix adds `.md` to the same extension-exclusion list every
 * other static-asset extension is already on, so middleware (and this
 * false-404 logic) never runs for these paths at all in production — this
 * test asserts that against the real exported matcher pattern directly,
 * since Next.js's actual request-to-middleware dispatch (which `matcher`
 * configures) isn't itself exercised by calling `middleware()` in a test.
 */
describe('middleware — config.matcher excludes real static .md files (#2218)', () => {
  // The matcher value itself, re-imported fresh so this test breaks loudly
  // if the pattern/shape ever changes, rather than silently testing a stale
  // copy pasted into the test file.
  async function matcherPattern(): Promise<RegExp> {
    const mod = await import('@/middleware')
    const last = mod.config.matcher[mod.config.matcher.length - 1]
    return new RegExp(last)
  }

  it('does NOT match real static .md files — middleware never runs for them', async () => {
    const pattern = await matcherPattern()
    expect(pattern.test('/SKILL.md')).toBe(false)
    expect(pattern.test('/auth.md')).toBe(false)
    expect(pattern.test('/AGENTS.md')).toBe(false)
  })

  it('still matches a real page path — the exclusion is scoped to the extension, not overly broad', async () => {
    const pattern = await matcherPattern()
    expect(pattern.test('/pricing')).toBe(true)
    expect(pattern.test('/build/wrench')).toBe(true)
  })

  it('still excludes the other pre-existing static-asset extensions (no regression from editing this pattern)', async () => {
    const pattern = await matcherPattern()
    for (const path of ['/llms.txt', '/sitemap.xml', '/manifest.json', '/favicon.ico']) {
      expect(pattern.test(path)).toBe(false)
    }
  })
})
