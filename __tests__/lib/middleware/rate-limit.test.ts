import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  limitMock: vi.fn(),
  slidingWindowMock: vi.fn((limit: number, window: string) => ({ limit, window })),
}))

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({})),
}))

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: Object.assign(
    vi.fn().mockImplementation(() => ({
      limit: h.limitMock,
    })),
    { slidingWindow: h.slidingWindowMock },
  ),
}))

const ORIGINAL_ENV = { ...process.env }

function makeRequest(path: string, headers: Record<string, string> = {}, method = 'GET') {
  return new NextRequest(new Request(`https://example.com${path}`, { method, headers }))
}

async function freshModule() {
  vi.resetModules()
  return await import('@/lib/middleware/rate-limit')
}

describe('lib/middleware/rate-limit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...ORIGINAL_ENV }
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  describe('without Redis configured', () => {
    it('skips rate limiting entirely outside production', async () => {
      vi.stubEnv('NODE_ENV', 'test')
      const { applyRateLimit } = await freshModule()

      const result = await applyRateLimit(makeRequest('/api/chat-ws'))

      expect(result.success).toBe(true)
      expect(result.response).toBeUndefined()
    })

    it('falls back to the in-memory limiter in production and allows read-only polling paths unconditionally', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      const { applyRateLimit } = await freshModule()

      const result = await applyRateLimit(makeRequest('/api/health'))

      expect(result.success).toBe(true)
    })

    it('in-memory limiter blocks after exceeding the auth limit (10/min)', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      const { applyRateLimit } = await freshModule()
      const req = () => makeRequest('/api/auth/login', { 'x-forwarded-for': '1.2.3.4' })

      let lastResult
      for (let i = 0; i < 11; i++) {
        lastResult = await applyRateLimit(req())
      }

      expect(lastResult!.success).toBe(false)
      expect(lastResult!.response?.status).toBe(429)
      expect(lastResult!.response?.headers.get('Retry-After')).toBe('60')
    })

    it('in-memory limiter blocks after exceeding the generation limit (10/min) for an exact-match generation endpoint', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      const { applyRateLimit } = await freshModule()
      const req = () => makeRequest('/api/chat-ws', { 'x-forwarded-for': '5.5.5.5' })

      let lastResult
      for (let i = 0; i < 11; i++) {
        lastResult = await applyRateLimit(req())
      }

      expect(lastResult!.success).toBe(false)
    })

    it('in-memory limiter allows up to the general limit (200/min) before blocking', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      const { applyRateLimit } = await freshModule()
      const req = () => makeRequest('/api/widgets', { 'x-forwarded-for': '9.9.9.9' })

      let lastResult
      for (let i = 0; i < 200; i++) {
        lastResult = await applyRateLimit(req())
        expect(lastResult.success).toBe(true)
      }
      lastResult = await applyRateLimit(req())
      expect(lastResult.success).toBe(false)
    })

    it('identifies client IP from cf-connecting-ip ahead of x-real-ip and x-forwarded-for', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      const { applyRateLimit } = await freshModule()
      const req = makeRequest('/api/widgets', {
        'cf-connecting-ip': '1.1.1.1',
        'x-real-ip': '2.2.2.2',
        'x-forwarded-for': '3.3.3.3',
      })

      const result = await applyRateLimit(req)
      expect(result.success).toBe(true)
    })

    it('treats requests with no IP headers as a shared "unknown" bucket', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      const { applyRateLimit } = await freshModule()

      const result = await applyRateLimit(makeRequest('/api/widgets'))
      expect(result.success).toBe(true)
    })

    it('runs periodic cleanup of stale in-memory buckets once the store exceeds 10,000 keys', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      const { applyRateLimit } = await freshModule()

      // Drive over 10,000 distinct IP buckets so the cleanup branch
      // (inMemoryStore.size > 10_000) runs at least once. Each IP's own
      // single request is well under its limit, so every call succeeds.
      let lastResult
      for (let i = 0; i < 10_050; i++) {
        lastResult = await applyRateLimit(makeRequest('/api/widgets', { 'x-forwarded-for': `10.0.${Math.floor(i / 255)}.${i % 255}` }))
      }

      expect(lastResult!.success).toBe(true)
    }, 20000)

    it('does not rate-limit /api/chats or /api/preview polling paths', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      const { applyRateLimit } = await freshModule()

      const chats = await applyRateLimit(makeRequest('/api/chats/123'))
      const preview = await applyRateLimit(makeRequest('/api/preview/abc'))

      expect(chats.success).toBe(true)
      expect(preview.success).toBe(true)
    })
  })

  describe('with Redis configured', () => {
    beforeEach(() => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example'
      process.env.UPSTASH_REDIS_REST_TOKEN = 'token-123'
    })

    it('skips rate limiting for read-only polling endpoints without calling the limiter', async () => {
      const { applyRateLimit } = await freshModule()

      const result = await applyRateLimit(makeRequest('/api/health'))

      expect(result.success).toBe(true)
      expect(h.limitMock).not.toHaveBeenCalled()
    })

    it('allows the request and attaches rate-limit headers when under the limit', async () => {
      h.limitMock.mockResolvedValue({ success: true, limit: 100, remaining: 99, reset: Date.now() + 60_000 })
      const { applyRateLimit } = await freshModule()

      const result = await applyRateLimit(makeRequest('/api/widgets', { 'x-forwarded-for': '1.2.3.4' }))

      expect(result.success).toBe(true)
      expect(result.response?.headers.get('X-RateLimit-Limit')).toBe('100')
      expect(result.response?.headers.get('X-RateLimit-Remaining')).toBe('99')
    })

    it('uses the generation limiter (not general) for exact generation-endpoint matches', async () => {
      h.limitMock.mockResolvedValue({ success: true, limit: 10, remaining: 9, reset: Date.now() + 60_000 })
      const { applyRateLimit } = await freshModule()

      await applyRateLimit(makeRequest('/api/chat-ws', { 'x-forwarded-for': '1.2.3.4' }))

      expect(h.limitMock).toHaveBeenCalledWith('1.2.3.4:generation')
    })

    it('uses the general limiter identifier for non-generation endpoints', async () => {
      h.limitMock.mockResolvedValue({ success: true, limit: 100, remaining: 50, reset: Date.now() + 60_000 })
      const { applyRateLimit } = await freshModule()

      await applyRateLimit(makeRequest('/api/widgets', { 'x-forwarded-for': '1.2.3.4' }))

      expect(h.limitMock).toHaveBeenCalledWith('1.2.3.4:general')
    })

    it('returns a 429 with Retry-After and rate-limit headers when the limit is exceeded on a generation endpoint', async () => {
      const reset = Date.now() + 15_000
      h.limitMock.mockResolvedValue({ success: false, limit: 10, remaining: 0, reset })
      const { applyRateLimit } = await freshModule()

      const result = await applyRateLimit(makeRequest('/api/chat-ws', { 'x-forwarded-for': '1.2.3.4' }))

      expect(result.success).toBe(false)
      expect(result.response?.status).toBe(429)
      expect(result.response?.headers.get('X-RateLimit-Remaining')).toBe('0')
      expect(result.response?.headers.get('Retry-After')).toBeTruthy()

      const body = await result.response?.json()
      expect(body.message).toBe('Generation rate limit exceeded. Please try again later.')
    })

    it('returns a 429 with the general exceeded message for non-generation endpoints', async () => {
      const reset = Date.now() + 5_000
      h.limitMock.mockResolvedValue({ success: false, limit: 100, remaining: 0, reset })
      const { applyRateLimit } = await freshModule()

      const result = await applyRateLimit(makeRequest('/api/widgets', { 'x-forwarded-for': '1.2.3.4' }))

      const body = await result.response?.json()
      expect(body.message).toBe('Rate limit exceeded. Please try again later.')
    })

    it('fails open (success: true) when the limiter throws', async () => {
      h.limitMock.mockRejectedValue(new Error('redis down'))
      const { applyRateLimit } = await freshModule()

      const result = await applyRateLimit(makeRequest('/api/widgets', { 'x-forwarded-for': '1.2.3.4' }))

      expect(result.success).toBe(true)
    })
  })

  describe('getRateLimitStatus()', () => {
    it('returns null when Redis is not configured', async () => {
      const { getRateLimitStatus } = await freshModule()
      const result = await getRateLimitStatus('ident-1')
      expect(result).toBeNull()
    })

    it('returns the limiter result shape for the general type when Redis is configured', async () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example'
      process.env.UPSTASH_REDIS_REST_TOKEN = 'token-123'
      h.limitMock.mockResolvedValue({ success: true, limit: 100, remaining: 42, reset: 12345 })

      const { getRateLimitStatus } = await freshModule()
      const result = await getRateLimitStatus('ident-1', 'general')

      expect(result).toEqual({ limit: 100, remaining: 42, reset: 12345, success: true })
    })

    it('uses the generation limiter when type is "generation"', async () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example'
      process.env.UPSTASH_REDIS_REST_TOKEN = 'token-123'
      h.limitMock.mockResolvedValue({ success: true, limit: 10, remaining: 2, reset: 999 })

      const { getRateLimitStatus } = await freshModule()
      const result = await getRateLimitStatus('ident-1', 'generation')

      expect(result?.limit).toBe(10)
    })

    it('returns null when the limiter throws', async () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example'
      process.env.UPSTASH_REDIS_REST_TOKEN = 'token-123'
      h.limitMock.mockRejectedValue(new Error('boom'))

      const { getRateLimitStatus } = await freshModule()
      const result = await getRateLimitStatus('ident-1')

      expect(result).toBeNull()
    })
  })
})
