import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/credits/estimate (#1213) — a complete, real, auth-gated proxy to
 * AINative's live POST /v1/managed/estimate (confirmed live: 401 without auth,
 * 422/200 with a real token — not a 404, the backing endpoint is real and
 * current). Had zero frontend callers before this issue; this test exercises
 * the route directly the way the skills/memory-proxy tests in this directory
 * do, ahead of wiring the Pricing screen consumer in the same PR.
 */

vi.mock('@/app/(auth)/auth', () => ({ auth: vi.fn() }))

function req(body: unknown) {
  return new NextRequest('http://localhost:3000/api/credits/estimate', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/credits/estimate', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn()
  })
  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('rejects an unauthenticated caller without calling AINative', async () => {
    const { auth } = await import('@/app/(auth)/auth')
    vi.mocked(auth).mockResolvedValue(null as any)

    const { POST } = await import('@/app/api/credits/estimate/route')
    const res = await POST(req({ model: 'claude-sonnet-4', estimated_tokens: 16000 }))

    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns a zero-cost placeholder for a session with no AINative access token, without calling the upstream', async () => {
    const { auth } = await import('@/app/(auth)/auth')
    vi.mocked(auth).mockResolvedValue({ user: { email: 'f@x.com' } } as any)

    const { POST } = await import('@/app/api/credits/estimate/route')
    const res = await POST(req({ model: 'claude-sonnet-4', estimated_tokens: 16000 }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.estimated_credits).toBe(0)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('forwards an authenticated request to the real AINative estimate endpoint and relays its response', async () => {
    const { auth } = await import('@/app/(auth)/auth')
    vi.mocked(auth).mockResolvedValue({ user: { email: 'f@x.com' }, accessToken: 'real-token-123' } as any)
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ model: 'claude-sonnet-4', estimated_tokens: 16000, estimated_credits: 3.25, credits_available: 100, can_afford: true }),
    })

    const { POST } = await import('@/app/api/credits/estimate/route')
    const res = await POST(req({ model: 'claude-sonnet-4', estimated_tokens: 16000 }))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.estimated_credits).toBe(3.25)
    expect(data.can_afford).toBe(true)

    const [url, opts] = (global.fetch as any).mock.calls[0]
    expect(String(url)).toContain('/v1/managed/estimate')
    expect((opts.headers as any).Authorization).toBe('Bearer real-token-123')
    const sentBody = JSON.parse(opts.body as string)
    expect(sentBody).toEqual({ model: 'claude-sonnet-4', estimated_tokens: 16000 })
  })

  it('propagates a real upstream error status honestly, never masking it as success', async () => {
    const { auth } = await import('@/app/(auth)/auth')
    vi.mocked(auth).mockResolvedValue({ user: { email: 'f@x.com' }, accessToken: 'real-token-123' } as any)
    ;(global.fetch as any).mockResolvedValue({ ok: false, status: 403, text: async () => 'Model not available on your plan' })

    const { POST } = await import('@/app/api/credits/estimate/route')
    const res = await POST(req({ model: 'claude-opus-4', estimated_tokens: 16000 }))

    expect(res.status).toBe(403)
  })
})
