import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1561 — /api/db/{table} must send real CORS headers back to a request
 * from the Sandpack bundler's origin, or the Sandpack db-token-shim's
 * cross-origin rewrite (lib/sandpack/db-token-shim.ts) is useless: the
 * request reaches and completes on the server, but the browser blocks the
 * response from ever reaching the generated app's own JS — the exact
 * silent-failure symptom #1561 reported on `silo-product`.
 *
 * Mirrors db-proxy-key-scoping-806.test.ts's own request-mock style (a
 * hand-built object matching NextRequest's read surface, not a real
 * NextRequest) so this test exercises the real exported GET/POST/OPTIONS
 * from the actual route module.
 */

const h = vi.hoisted(() => ({
  resolveCompanyZerodbKey: vi.fn(),
}))

vi.mock('@/lib/build/company-zerodb-credentials', () => ({
  resolveCompanyZerodbKey: h.resolveCompanyZerodbKey,
}))

process.env.AUTH_SECRET = 'test-secret-for-token-signing'

import { GET, POST, OPTIONS } from '@/app/api/db/[table]/route'

// NEXT_PUBLIC_* vars are inlined by the build/transform pipeline, not
// readable via a runtime process.env assignment in this test — so this
// test deliberately exercises the route's REAL fallback default (the stock
// CodeSandbox bundler host components/chat/sandpack-preview.tsx also
// defaults to) rather than trying to override it to a self-hosted URL.
const SANDBOX_ORIGIN = 'https://abc123.2-19-8-sandpack.codesandbox.io'

function req(url: string, opts: { origin?: string; body?: any } = {}) {
  const nextUrl = new URL(url)
  const headers = new Map<string, string>()
  if (opts.origin) headers.set('origin', opts.origin)
  return {
    nextUrl,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    json: async () => opts.body ?? {},
  } as any
}

const params = (table: string) => ({ params: Promise.resolve({ table }) })

describe('#1561 — CORS headers on /api/db for the Sandpack bundler origin', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ total: 0, data: [] }),
      text: async () => '',
    }) as any
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('OPTIONS preflight from a real Sandpack sandbox origin gets a 204 with the right CORS headers', async () => {
    const res = await OPTIONS(req('http://localhost/api/db/todos', { origin: SANDBOX_ORIGIN }))
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SANDBOX_ORIGIN)
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('x-ainative-db-token')
  })

  it('OPTIONS preflight from an unrelated origin gets a bare 204 (no CORS headers)', async () => {
    const res = await OPTIONS(req('http://localhost/api/db/todos', { origin: 'https://evil.example.com' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('a successful GET from a Sandpack sandbox origin carries the reflected CORS header', async () => {
    const res = await GET(req('http://localhost/api/db/todos', { origin: SANDBOX_ORIGIN }), params('todos'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SANDBOX_ORIGIN)
  })

  it('a POST from a Sandpack sandbox origin carries the reflected CORS header', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // ensureTable
      .mockResolvedValueOnce({ ok: true, json: async () => ({ row_data: { name: 'x' }, row_id: '1' }) }) as any
    const res = await POST(
      req('http://localhost/api/db/todos', { origin: SANDBOX_ORIGIN, body: { name: 'x' } }),
      params('todos'),
    )
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SANDBOX_ORIGIN)
  })

  it('a request with NO origin header (same-origin, the pre-existing single-file preview path) gets no CORS header and is otherwise unaffected', async () => {
    const res = await GET(req('http://localhost/api/db/todos'), params('todos'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
