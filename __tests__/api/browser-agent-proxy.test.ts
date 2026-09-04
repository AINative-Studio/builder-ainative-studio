import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mintAppDataToken } from '@/lib/build/app-data-token'

/**
 * /api/browser-agent/[action] (#499) — the Browser Agent runtime proxy.
 *
 * Real gap this closes: primitive-catalog.ts's Browser Agent entry documents
 * a real, live REST API (confirmed #411/#413: GET .../health lists real
 * endpoints), but nothing wired a generated app to actually call it — same
 * "Cody references a primitive with no real runtime path" class of bug #443
 * fixed for the founder-scoped 5, extended here exactly like #496 (ZeroMemory).
 *
 * Reuses the SAME signed per-app data token /api/db and /api/memory already
 * verify (lib/build/app-data-token.ts) rather than inventing a new auth
 * scheme — mintAppDataToken here produces a REAL, validly-signed token so
 * these tests exercise the actual HMAC verify path, not a mock.
 */

function req(action: string, body: unknown, token?: string) {
  return {
    url: `https://builder.ainative.studio/api/browser-agent/${action}`,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : null),
    },
    nextUrl: { searchParams: new URLSearchParams() },
    json: async () => body,
  } as any
}

describe('POST /api/browser-agent/[action]', () => {
  const originalFetch = global.fetch
  const realToken = mintAppDataToken('proj-real-123', 'beacon', Math.floor(Date.now() / 1000))

  beforeEach(() => {
    global.fetch = vi.fn()
  })
  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('rejects a request with no token at all — fails closed', async () => {
    const { POST } = await import('@/app/api/browser-agent/[action]/route')
    const res = await POST(req('extract', { url: 'https://example.com', extract_goal: 'x' }), { params: Promise.resolve({ action: 'extract' }) })
    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects a present-but-forged token — fails closed, never trusts an unsigned payload', async () => {
    const { POST } = await import('@/app/api/browser-agent/[action]/route')
    const res = await POST(req('extract', { url: 'https://example.com', extract_goal: 'x' }, 'forged.token.here'), { params: Promise.resolve({ action: 'extract' }) })
    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('extract: forwards url + extract_goal to the real endpoint', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { page_title: 'Example Domain' }, session_id: 's1', url: 'https://example.com/', error: null }) })
    const { POST } = await import('@/app/api/browser-agent/[action]/route')
    const res = await POST(req('extract', { url: 'https://example.com', extract_goal: 'get the page title' }, realToken), { params: Promise.resolve({ action: 'extract' }) })
    expect(res.status).toBe(200)
    const [url, opts] = (global.fetch as any).mock.calls[0]
    expect(String(url)).toContain('/extract')
    const sentBody = JSON.parse((opts as RequestInit).body as string)
    expect(sentBody.url).toBe('https://example.com')
    expect(sentBody.extract_goal).toBe('get the page title')
  })

  it('extract: rejects missing url without calling the real API', async () => {
    const { POST } = await import('@/app/api/browser-agent/[action]/route')
    const res = await POST(req('extract', { extract_goal: 'x' }, realToken), { params: Promise.resolve({ action: 'extract' }) })
    expect(res.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('extract: rejects missing extract_goal without calling the real API', async () => {
    const { POST } = await import('@/app/api/browser-agent/[action]/route')
    const res = await POST(req('extract', { url: 'https://example.com' }, realToken), { params: Promise.resolve({ action: 'extract' }) })
    expect(res.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('act: forwards url + instruction to the real endpoint', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ success: true, action_taken: 'click', session_id: 's1', url: 'https://example.com/', error: null }) })
    const { POST } = await import('@/app/api/browser-agent/[action]/route')
    const res = await POST(req('act', { url: 'https://example.com', instruction: 'click the link' }, realToken), { params: Promise.resolve({ action: 'act' }) })
    expect(res.status).toBe(200)
    const [url, opts] = (global.fetch as any).mock.calls[0]
    expect(String(url)).toContain('/act')
    const sentBody = JSON.parse((opts as RequestInit).body as string)
    expect(sentBody.url).toBe('https://example.com')
    expect(sentBody.instruction).toBe('click the link')
  })

  it('act: rejects missing instruction without calling the real API', async () => {
    const { POST } = await import('@/app/api/browser-agent/[action]/route')
    const res = await POST(req('act', { url: 'https://example.com' }, realToken), { params: Promise.resolve({ action: 'act' }) })
    expect(res.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('an unknown action returns 404, never silently no-ops', async () => {
    const { POST } = await import('@/app/api/browser-agent/[action]/route')
    const res = await POST(req('delete-everything', {}, realToken), { params: Promise.resolve({ action: 'delete-everything' }) })
    expect(res.status).toBe(404)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('propagates a real upstream error status honestly, never masks it as success', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: false, status: 422, json: async () => ({ detail: 'bad url' }) })
    const { POST } = await import('@/app/api/browser-agent/[action]/route')
    const res = await POST(req('extract', { url: 'https://example.com', extract_goal: 'x' }, realToken), { params: Promise.resolve({ action: 'extract' }) })
    expect(res.status).toBe(422)
  })
})
