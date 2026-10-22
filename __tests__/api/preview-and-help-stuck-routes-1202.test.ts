import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * #1202 (Coverage Phase 2, pass 4) — app/api/preview/route.ts (standalone
 * sandboxed-component HTML preview, distinct from the preview-store-backed
 * app/api/preview/[id] route already covered elsewhere) and
 * app/api/help/stuck/route.ts (the "I'm stuck" search box) had zero
 * route-level coverage.
 *
 * app/api/preview is pure (crypto nonce + string templating, no external
 * I/O) — tested directly with no mocks. app/api/help/stuck's retrieval
 * logic (lib/help/stuck-search.ts) is already tested at the lib layer, so
 * it's mocked here to keep this file focused on the route's own
 * request-parsing/validation branches.
 */

const stuckSearch = vi.hoisted(() => ({
  searchStuck: vi.fn((_question: string, _limit?: number): any[] => []),
  DEFAULT_RESULT_LIMIT: 5,
}))
vi.mock('@/lib/help/stuck-search', () => stuckSearch)

function postRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function malformedPostRequest(url: string) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not valid json',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  stuckSearch.searchStuck.mockReturnValue([])
})

describe('#1202 POST /api/preview', () => {
  it('returns 400 when no code is provided', async () => {
    const { POST } = await import('@/app/api/preview/route')
    const res = await POST(postRequest('http://localhost/api/preview', {}))
    expect(res.status).toBe(400)
  })

  it('wraps a fenced code block into a renderable HTML page with security headers', async () => {
    const { POST } = await import('@/app/api/preview/route')
    const code = '```tsx\nexport default function App() { return <div>Hi</div> }\n```'
    const res = await POST(postRequest('http://localhost/api/preview', { code }))

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html')
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'")

    const html = await res.text()
    expect(html).toContain('const Component =')
    expect(html).toContain('ReactDOM.render')
  })

  it('falls back to raw code when no markdown fence is present', async () => {
    const { POST } = await import('@/app/api/preview/route')
    const res = await POST(postRequest('http://localhost/api/preview', { code: 'export default function App() {}' }))

    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('const Component =')
  })

  it('returns 500 when the request body is malformed JSON', async () => {
    const { POST } = await import('@/app/api/preview/route')
    const res = await POST(malformedPostRequest('http://localhost/api/preview'))
    expect(res.status).toBe(500)
  })
})

describe('#1202 GET /api/preview', () => {
  it('returns a simple usage message', async () => {
    const { GET } = await import('@/app/api/preview/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ message: 'Use POST to generate preview' })
  })
})

describe('#1202 POST /api/help/stuck', () => {
  it('returns 400 when the question is empty', async () => {
    const { POST } = await import('@/app/api/help/stuck/route')
    const res = await POST(postRequest('http://localhost/api/help/stuck', { question: '' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when the question field is missing entirely', async () => {
    const { POST } = await import('@/app/api/help/stuck/route')
    const res = await POST(postRequest('http://localhost/api/help/stuck', {}))
    expect(res.status).toBe(400)
  })

  it('returns 400 when the body is malformed JSON (caught, treated as empty)', async () => {
    const { POST } = await import('@/app/api/help/stuck/route')
    const res = await POST(malformedPostRequest('http://localhost/api/help/stuck'))
    expect(res.status).toBe(400)
  })

  it('searches and returns results for a real question, truncated to the max length', async () => {
    stuckSearch.searchStuck.mockReturnValue([
      { href: '/guides/foo#bar', title: 'Foo', parentTitle: 'Guides', source: 'guide', snippet: 'snippet text', score: 0.9 },
    ])
    const longQuestion = 'why is '.repeat(100) // > 500 chars once repeated
    const { POST } = await import('@/app/api/help/stuck/route')
    const res = await POST(postRequest('http://localhost/api/help/stuck', { question: longQuestion }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results).toHaveLength(1)
    const [calledQuestion, calledLimit] = stuckSearch.searchStuck.mock.calls[0]
    expect(calledQuestion.length).toBeLessThanOrEqual(500)
    expect(calledLimit).toBe(5)
  })
})
