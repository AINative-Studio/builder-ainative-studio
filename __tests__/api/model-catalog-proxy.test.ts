import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mintAppDataToken } from '@/lib/build/app-data-token'

/**
 * /api/model-catalog/[action] (#505) — the Model Catalog runtime proxy.
 *
 * Real gap closed: primitive-catalog.ts's Model Catalog entry ("47 models
 * across text/code/reasoning/image/video/audio/embedding") had no apiBase
 * at all and zero builder-side wiring.
 *
 * Auth confirmed live: GET /api/v1/public/models with no key -> 401
 * AUTH_REQUIRED; with builder's existing shared X-API-Key -> 200, 61 real
 * models. No separate provisioning needed.
 *
 * Scope is deliberately narrow: only `list` (account-level, safe, read-only,
 * live-confirmed 200 with 61 real models). A single-model lookup route also
 * exists but expects a UUID model_id, not the string `id` the list endpoint
 * returns (confirmed live: the string id 422s as an invalid UUID) — NOT
 * wired here since the real UUID values were not independently confirmed.
 *
 * Reuses the SAME signed per-app data token /api/db, /api/memory,
 * /api/agent402, and /api/opencapstack already verify (mintAppDataToken here
 * produces a REAL, validly-signed token, not a mock).
 */

function req(action: string, token?: string) {
  return {
    url: `https://builder.ainative.studio/api/model-catalog/${action}`,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : null),
    },
    nextUrl: { searchParams: new URLSearchParams() },
  } as any
}

describe('GET /api/model-catalog/[action]', () => {
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
    const { GET } = await import('@/app/api/model-catalog/[action]/route')
    const res = await GET(req('list'), { params: Promise.resolve({ action: 'list' }) })
    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects a present-but-forged token — fails closed', async () => {
    const { GET } = await import('@/app/api/model-catalog/[action]/route')
    const res = await GET(req('list', 'forged.token.here'), { params: Promise.resolve({ action: 'list' }) })
    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('list: forwards to the real upstream endpoint with a valid token', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ ok: true, models: [] }) })
    const { GET } = await import('@/app/api/model-catalog/[action]/route')
    const res = await GET(req('list', realToken), { params: Promise.resolve({ action: 'list' }) })
    expect(res.status).toBe(200)
    const [url] = (global.fetch as any).mock.calls[0]
    expect(String(url)).toContain('/models')
  })

  it('an unknown action returns 404, never silently no-ops', async () => {
    const { GET } = await import('@/app/api/model-catalog/[action]/route')
    const res = await GET(req('get-model', realToken), { params: Promise.resolve({ action: 'get-model' }) })
    expect(res.status).toBe(404)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('propagates a real upstream error status honestly, never masks it as success', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: false, status: 502, json: async () => ({ detail: 'upstream error' }) })
    const { GET } = await import('@/app/api/model-catalog/[action]/route')
    const res = await GET(req('list', realToken), { params: Promise.resolve({ action: 'list' }) })
    expect(res.status).toBe(502)
  })
})
