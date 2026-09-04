import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mintAppDataToken } from '@/lib/build/app-data-token'

/**
 * /api/developer-program/[action] (#505) — the Developer Program runtime
 * proxy.
 *
 * Real gap closed: primitive-catalog.ts's Developer Program entry ("Let the
 * app monetize itself: 0-40% markup + Stripe Connect payouts") had zero
 * builder-side wiring.
 *
 * AUTH CONFIRMED LIVE (2026-09-04): builder's existing shared service key
 * authenticates directly against GET /api/v1/public/developer/analytics
 * (real 200, platform metrics) and GET /api/v1/public/developer/logs (real
 * 200, request log entries) via X-API-Key.
 *
 * Scope is deliberately narrow: analytics + logs only (platform-level,
 * safe, read-only, both live-confirmed 200). earnings and payouts were
 * tested and BOTH genuinely 401 with builder's shared key — these are
 * per-developer-account resources the shared key has no bound identity for.
 * Even if they authenticated, this is real money (Stripe Connect payouts) —
 * deliberately excluded, matching Agent402's (#500) exclusion of
 * payments/Hedera operations.
 *
 * Reuses the SAME signed per-app data token /api/db, /api/memory, and
 * /api/agent402 verify (mintAppDataToken here produces a REAL,
 * validly-signed token, not a mock).
 */

function req(action: string, token?: string) {
  return {
    url: `https://builder.ainative.studio/api/developer-program/${action}`,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : null),
    },
    nextUrl: { searchParams: new URLSearchParams() },
  } as any
}

describe('GET /api/developer-program/[action]', () => {
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
    const { GET } = await import('@/app/api/developer-program/[action]/route')
    const res = await GET(req('analytics'), { params: Promise.resolve({ action: 'analytics' }) })
    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects a present-but-forged token — fails closed', async () => {
    const { GET } = await import('@/app/api/developer-program/[action]/route')
    const res = await GET(req('analytics', 'forged.token.here'), { params: Promise.resolve({ action: 'analytics' }) })
    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('analytics: forwards to the real upstream endpoint with a valid token', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ total_requests: 1484727 }) })
    const { GET } = await import('@/app/api/developer-program/[action]/route')
    const res = await GET(req('analytics', realToken), { params: Promise.resolve({ action: 'analytics' }) })
    expect(res.status).toBe(200)
    const [url] = (global.fetch as any).mock.calls[0]
    expect(String(url)).toContain('/analytics')
  })

  it('logs: forwards to the real upstream endpoint with a valid token', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ logs: [], pagination: { total: 0 } }) })
    const { GET } = await import('@/app/api/developer-program/[action]/route')
    const res = await GET(req('logs', realToken), { params: Promise.resolve({ action: 'logs' }) })
    expect(res.status).toBe(200)
    const [url] = (global.fetch as any).mock.calls[0]
    expect(String(url)).toContain('/logs')
  })

  it('an unknown action returns 404, never silently no-ops', async () => {
    const { GET } = await import('@/app/api/developer-program/[action]/route')
    const res = await GET(req('earnings', realToken), { params: Promise.resolve({ action: 'earnings' }) })
    expect(res.status).toBe(404)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('never exposes earnings/payouts — deliberately not in the allowlist (real money, per-account, and confirmed 401 with the shared key)', async () => {
    const { GET } = await import('@/app/api/developer-program/[action]/route')
    for (const action of ['earnings', 'payouts', 'stripe-connect', 'withdraw']) {
      const res = await GET(req(action, realToken), { params: Promise.resolve({ action }) })
      expect(res.status).toBe(404)
    }
  })

  it('propagates a real upstream error status honestly, never masks it as success', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: false, status: 502, json: async () => ({ detail: 'upstream error' }) })
    const { GET } = await import('@/app/api/developer-program/[action]/route')
    const res = await GET(req('analytics', realToken), { params: Promise.resolve({ action: 'analytics' }) })
    expect(res.status).toBe(502)
  })
})
