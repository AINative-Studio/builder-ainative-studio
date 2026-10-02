import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * #885 — /api/build/media (MiniMax video/image generation through core) was
 * missing from the `isGeneration` match list in both rate-limit checks, so it
 * fell into the generic 200-req/min bucket instead of the 10/req/min
 * generation bucket meant for expensive AI calls — a 20x gap on the most
 * expensive endpoint in this stack.
 *
 * These tests exercise the in-memory limiter directly (no Upstash env vars
 * configured in the test environment) by forcing NODE_ENV=production so the
 * real bucket-selection logic in `applyRateLimit` runs instead of short-
 * circuiting to `{ success: true }` for local/dev.
 */

describe('rate-limit: /api/build/media generation bucket (#885)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function req(pathname: string, ip: string): any {
    const headers = new Map<string, string>([['x-forwarded-for', ip]])
    return {
      nextUrl: { pathname },
      method: 'POST',
      headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    }
  }

  it('hits the 10/min generation bucket for /api/build/media, not the 200/min general bucket', async () => {
    const { applyRateLimit } = await import('@/lib/middleware/rate-limit')
    const ip = '203.0.113.10'

    // The generation bucket allows 10 requests/min. Exhaust it.
    for (let i = 0; i < 10; i++) {
      const { success } = await applyRateLimit(req('/api/build/media', ip) as any)
      expect(success).toBe(true)
    }

    // The 11th request from the same IP against /api/build/media must now be
    // rejected — proving it shares the strict generation bucket, not the
    // 200/min general bucket (which would still have ~190 requests left).
    const { success, response } = await applyRateLimit(req('/api/build/media', ip) as any)
    expect(success).toBe(false)
    expect(response?.status).toBe(429)
  })

  it('does not rate-limit a generic API route after only 10 requests (sanity check against the general 200/min bucket)', async () => {
    const { applyRateLimit } = await import('@/lib/middleware/rate-limit')
    const ip = '203.0.113.20'

    for (let i = 0; i < 10; i++) {
      const { success } = await applyRateLimit(req('/api/some-generic-route', ip) as any)
      expect(success).toBe(true)
    }

    // The 11th request on the generic bucket must still pass (limit is 200).
    const { success } = await applyRateLimit(req('/api/some-generic-route', ip) as any)
    expect(success).toBe(true)
  })
})
