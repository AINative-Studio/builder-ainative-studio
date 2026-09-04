import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mintAppDataToken } from '@/lib/build/app-data-token'

/**
 * /api/community/[action] (#505) — the Community runtime proxy.
 *
 * Real gap closed: primitive-catalog.ts's Community entry ("groups,
 * membership, events, social feeds and interactions") had zero builder-side
 * wiring.
 *
 * AUTH CONFIRMED LIVE (2026-09-04): builder's existing shared service key
 * authenticates directly against GET /api/v1/community/members (real 200,
 * real 4497-member directory) via X-API-Key.
 *
 * Scope is deliberately narrow: members only. feed/posts/events/messages
 * were investigated and NOT wired:
 *  - GET /api/v1/community/feed  -> real 400 "Tenant ID is required" (needs
 *    per-company scoping this pass didn't build — a real follow-up).
 *  - GET /api/v1/community/posts -> real 404 with the shared key (shape not
 *    confirmed).
 *  - messages/moderation/events were not tested — write-capable or
 *    identity-scoped, deliberately left uninvestigated.
 *
 * Reuses the SAME signed per-app data token /api/db, /api/memory,
 * /api/agent402, and /api/developer-program verify (mintAppDataToken here
 * produces a REAL, validly-signed token, not a mock).
 */

function req(action: string, token?: string) {
  return {
    url: `https://builder.ainative.studio/api/community/${action}`,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : null),
    },
    nextUrl: { searchParams: new URLSearchParams() },
  } as any
}

describe('GET /api/community/[action]', () => {
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
    const { GET } = await import('@/app/api/community/[action]/route')
    const res = await GET(req('members'), { params: Promise.resolve({ action: 'members' }) })
    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects a present-but-forged token — fails closed', async () => {
    const { GET } = await import('@/app/api/community/[action]/route')
    const res = await GET(req('members', 'forged.token.here'), { params: Promise.resolve({ action: 'members' }) })
    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('members: forwards to the real upstream endpoint with a valid token', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ data: [], total: 4497 }) })
    const { GET } = await import('@/app/api/community/[action]/route')
    const res = await GET(req('members', realToken), { params: Promise.resolve({ action: 'members' }) })
    expect(res.status).toBe(200)
    const [url] = (global.fetch as any).mock.calls[0]
    expect(String(url)).toContain('/members')
  })

  it('an unknown action returns 404, never silently no-ops', async () => {
    const { GET } = await import('@/app/api/community/[action]/route')
    const res = await GET(req('feed', realToken), { params: Promise.resolve({ action: 'feed' }) })
    expect(res.status).toBe(404)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('never exposes feed/posts/messages/moderation — deliberately not in the allowlist (unconfirmed shapes / write-capable)', async () => {
    const { GET } = await import('@/app/api/community/[action]/route')
    for (const action of ['feed', 'posts', 'messages', 'moderation', 'events']) {
      const res = await GET(req(action, realToken), { params: Promise.resolve({ action }) })
      expect(res.status).toBe(404)
    }
  })

  it('propagates a real upstream error status honestly, never masks it as success', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: false, status: 502, json: async () => ({ detail: 'upstream error' }) })
    const { GET } = await import('@/app/api/community/[action]/route')
    const res = await GET(req('members', realToken), { params: Promise.resolve({ action: 'members' }) })
    expect(res.status).toBe(502)
  })
})
