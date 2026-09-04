import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mintAppDataToken } from '@/lib/build/app-data-token'

/**
 * /api/agent402/[action] (#500) — the Agent402 runtime proxy.
 *
 * Real gap closed: primitive-catalog.ts's Agent402 entry had zero
 * builder-side wiring. Auth was a genuine open question — Agent402's own
 * /v1/public/provision documents a wallet-signature (EIP-191) flow that
 * looked like a hard blocker — RESOLVED by direct testing: builder's
 * existing shared service key already authenticates against Agent402
 * (confirmed live: GET /v1/public/projects → 200, GET /v1/public/keys → 405
 * not 401/403 — auth genuinely succeeds, just wrong verb). No wallet
 * involved, matches "Usage billed via AINative Studio credits" in Agent402's
 * own /v1/public/capabilities response.
 *
 * Scope is deliberately narrow: only capabilities + projects (account-level,
 * safe, read-only, both live-confirmed 200). Agent memory (remember/list)
 * was tested and found genuinely broken on Agent402's OWN backend (its
 * project_id path param is silently ignored, upstream 401s against its own
 * hardcoded internal project) — a real external bug, not wired here.
 * Payments/on-chain/Hedera operations are deliberately excluded — real-money
 * risk, out of scope for a first pass.
 *
 * Reuses the SAME signed per-app data token /api/db and /api/memory verify
 * (mintAppDataToken here produces a REAL, validly-signed token, not a mock).
 */

function req(action: string, token?: string) {
  return {
    url: `https://builder.ainative.studio/api/agent402/${action}`,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : null),
    },
    nextUrl: { searchParams: new URLSearchParams() },
  } as any
}

describe('GET /api/agent402/[action]', () => {
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
    const { GET } = await import('@/app/api/agent402/[action]/route')
    const res = await GET(req('capabilities'), { params: Promise.resolve({ action: 'capabilities' }) })
    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects a present-but-forged token — fails closed', async () => {
    const { GET } = await import('@/app/api/agent402/[action]/route')
    const res = await GET(req('capabilities', 'forged.token.here'), { params: Promise.resolve({ action: 'capabilities' }) })
    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('capabilities: forwards to the real upstream endpoint with a valid token', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ service: 'Agent-402' }) })
    const { GET } = await import('@/app/api/agent402/[action]/route')
    const res = await GET(req('capabilities', realToken), { params: Promise.resolve({ action: 'capabilities' }) })
    expect(res.status).toBe(200)
    const [url] = (global.fetch as any).mock.calls[0]
    expect(String(url)).toContain('/v1/public/capabilities')
  })

  it('projects: forwards to the real upstream endpoint with a valid token', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ projects: [], total: 0 }) })
    const { GET } = await import('@/app/api/agent402/[action]/route')
    const res = await GET(req('projects', realToken), { params: Promise.resolve({ action: 'projects' }) })
    expect(res.status).toBe(200)
    const [url] = (global.fetch as any).mock.calls[0]
    expect(String(url)).toContain('/v1/public/projects')
  })

  it('an unknown action returns 404, never silently no-ops', async () => {
    const { GET } = await import('@/app/api/agent402/[action]/route')
    const res = await GET(req('agent-memory', realToken), { params: Promise.resolve({ action: 'agent-memory' }) })
    expect(res.status).toBe(404)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('never exposes payments/hedera/billing actions — deliberately not in the allowlist', async () => {
    const { GET } = await import('@/app/api/agent402/[action]/route')
    for (const action of ['payments', 'hedera', 'billing', 'x402-requests']) {
      const res = await GET(req(action, realToken), { params: Promise.resolve({ action }) })
      expect(res.status).toBe(404)
    }
  })

  it('propagates a real upstream error status honestly, never masks it as success', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: false, status: 502, json: async () => ({ detail: 'upstream error' }) })
    const { GET } = await import('@/app/api/agent402/[action]/route')
    const res = await GET(req('projects', realToken), { params: Promise.resolve({ action: 'projects' }) })
    expect(res.status).toBe(502)
  })
})
