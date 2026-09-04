import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mintAppDataToken } from '@/lib/build/app-data-token'

/**
 * /api/memory/[action] (#496) — the ZeroMemory runtime proxy.
 *
 * Real gap this closes: primitive-catalog.ts's ZeroMemory entry was correct
 * that no separate provisioning is needed (confirmed live: builder's own
 * ZeroDB service key gets a real 200 from both /remember and /recall), but
 * NOTHING wired a generated app to actually call it — the exact "Cody
 * references a primitive that fails at runtime" class of bug #443 fixed for
 * the founder-scoped 5, never extended here.
 *
 * Reuses the SAME signed per-app data token /api/db already verifies
 * (lib/build/app-data-token.ts) rather than inventing a new auth scheme —
 * mintAppDataToken here produces a REAL, validly-signed token so these tests
 * exercise the actual HMAC verify path, not a mock.
 */

function req(action: string, body: unknown, token?: string) {
  return {
    url: `https://builder.ainative.studio/api/memory/${action}`,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : null),
    },
    nextUrl: { searchParams: new URLSearchParams() },
    json: async () => body,
  } as any
}

describe('POST /api/memory/[action]', () => {
  const originalFetch = global.fetch
  const realToken = mintAppDataToken('proj-real-123', 'beacon', Math.floor(Date.now() / 1000))

  beforeEach(() => {
    global.fetch = vi.fn()
  })
  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('rejects a request with no token at all — fails closed, never falls back to a shared namespace', async () => {
    const { POST } = await import('@/app/api/memory/[action]/route')
    const res = await POST(req('remember', { content: 'x' }), { params: Promise.resolve({ action: 'remember' }) })
    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects a present-but-forged token — fails closed, never trusts an unsigned payload', async () => {
    const { POST } = await import('@/app/api/memory/[action]/route')
    const res = await POST(req('remember', { content: 'x' }, 'forged.token.here'), { params: Promise.resolve({ action: 'remember' }) })
    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('remember: forwards to the real endpoint with the company-scoped namespace injected', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ memory_id: 'm1', status: 'stored' }) })
    const { POST } = await import('@/app/api/memory/[action]/route')
    const res = await POST(req('remember', { content: 'a real memory' }, realToken), { params: Promise.resolve({ action: 'remember' }) })
    expect(res.status).toBe(200)
    const [url, opts] = (global.fetch as any).mock.calls[0]
    expect(String(url)).toContain('/remember')
    const sentBody = JSON.parse((opts as RequestInit).body as string)
    expect(sentBody.namespace).toBe('project:proj-real-123')
    expect(sentBody.content).toBe('a real memory')
  })

  it('remember: rejects empty content without calling the real API', async () => {
    const { POST } = await import('@/app/api/memory/[action]/route')
    const res = await POST(req('remember', { content: '  ' }, realToken), { params: Promise.resolve({ action: 'remember' }) })
    expect(res.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('recall: forwards the query with the company-scoped namespace injected', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ results: [], count: 0 }) })
    const { POST } = await import('@/app/api/memory/[action]/route')
    const res = await POST(req('recall', { query: 'find something' }, realToken), { params: Promise.resolve({ action: 'recall' }) })
    expect(res.status).toBe(200)
    const [url, opts] = (global.fetch as any).mock.calls[0]
    expect(String(url)).toContain('/recall')
    const sentBody = JSON.parse((opts as RequestInit).body as string)
    expect(sentBody.namespace).toBe('project:proj-real-123')
    expect(sentBody.query).toBe('find something')
  })

  it('a different company gets a different namespace — never cross-tenant readable', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ results: [] }) })
    const otherToken = mintAppDataToken('proj-other-456', 'acme', Math.floor(Date.now() / 1000))
    const { POST } = await import('@/app/api/memory/[action]/route')
    await POST(req('recall', { query: 'x' }, otherToken), { params: Promise.resolve({ action: 'recall' }) })
    const sentBody = JSON.parse((global.fetch as any).mock.calls[0][1].body)
    expect(sentBody.namespace).toBe('project:proj-other-456')
  })

  it('an unknown action returns 404, never silently no-ops', async () => {
    const { POST } = await import('@/app/api/memory/[action]/route')
    const res = await POST(req('delete-everything', {}, realToken), { params: Promise.resolve({ action: 'delete-everything' }) })
    expect(res.status).toBe(404)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('propagates a real upstream error status honestly, never masks it as success', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: false, status: 422, json: async () => ({ detail: 'bad namespace' }) })
    const { POST } = await import('@/app/api/memory/[action]/route')
    const res = await POST(req('recall', { query: 'x' }, realToken), { params: Promise.resolve({ action: 'recall' }) })
    expect(res.status).toBe(422)
  })
})
