import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mintAppDataToken } from '@/lib/build/app-data-token'

/**
 * /api/ainative-ngo/[action] — the AINativeNGO ("InstitutionOS") runtime proxy.
 *
 * Real gap closed: primitive-catalog.ts's AINativeNGO entry claimed "Live
 * API verified" but had zero builder-side wiring — Cody could reference it
 * in codegen with no real runtime path. RESOLVED by direct testing:
 *   GET https://ngo.ainative.studio/api/v1/institutions -H "X-API-Key: <builder's real key>"
 *   -> 200, real institution rows.
 * Builder's existing shared service key already authenticates — no separate
 * provisioning needed.
 *
 * Scope is deliberately narrow: only institutions (account-level, safe,
 * read-only, live-confirmed 200). The other ~359 endpoints in AINativeNGO's
 * real OpenAPI spec were NOT independently verified in this pass.
 *
 * Reuses the SAME signed per-app data token /api/db, /api/memory, and
 * /api/agent402 verify (mintAppDataToken here produces a REAL, validly-
 * signed token, not a mock).
 */

function req(action: string, token?: string) {
  return {
    url: `https://builder.ainative.studio/api/ainative-ngo/${action}`,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : null),
    },
    nextUrl: { searchParams: new URLSearchParams() },
  } as any
}

describe('GET /api/ainative-ngo/[action]', () => {
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
    const { GET } = await import('@/app/api/ainative-ngo/[action]/route')
    const res = await GET(req('institutions'), { params: Promise.resolve({ action: 'institutions' }) })
    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects a present-but-forged token — fails closed', async () => {
    const { GET } = await import('@/app/api/ainative-ngo/[action]/route')
    const res = await GET(req('institutions', 'forged.token.here'), { params: Promise.resolve({ action: 'institutions' }) })
    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('institutions: forwards to the real upstream endpoint with a valid token', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ([{ name: 'Hope Community Foundation' }]) })
    const { GET } = await import('@/app/api/ainative-ngo/[action]/route')
    const res = await GET(req('institutions', realToken), { params: Promise.resolve({ action: 'institutions' }) })
    expect(res.status).toBe(200)
    const [url] = (global.fetch as any).mock.calls[0]
    expect(String(url)).toContain('/institutions')
  })

  it('an unknown action returns 404, never silently no-ops', async () => {
    const { GET } = await import('@/app/api/ainative-ngo/[action]/route')
    const res = await GET(req('grants', realToken), { params: Promise.resolve({ action: 'grants' }) })
    expect(res.status).toBe(404)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('never exposes board/compliance/audit/donor actions — deliberately not in the allowlist', async () => {
    const { GET } = await import('@/app/api/ainative-ngo/[action]/route')
    for (const action of ['board', 'compliance', 'donors', 'audit', 'permissions']) {
      const res = await GET(req(action, realToken), { params: Promise.resolve({ action }) })
      expect(res.status).toBe(404)
    }
  })

  it('propagates a real upstream error status honestly, never masks it as success', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: false, status: 502, json: async () => ({ detail: 'upstream error' }) })
    const { GET } = await import('@/app/api/ainative-ngo/[action]/route')
    const res = await GET(req('institutions', realToken), { params: Promise.resolve({ action: 'institutions' }) })
    expect(res.status).toBe(502)
  })
})
