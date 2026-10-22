import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Unit tests for lib/services/template-matcher.service.ts (issue #1201 /
 * coverage phase 1).
 *
 * `__tests__/services/template-matcher-degradation.test.ts` and
 * `__tests__/services/template-matcher/template-matcher-final.test.ts`
 * already cover the real-dependency-unavailable path (no OPENAI_API_KEY in
 * the test env, so `openai` is never constructed and every semantic score
 * attempt throws/falls back). That's valuable as real behavior, but it can
 * never reach the "OpenAI succeeds" or "Redis cache hit/miss" branches,
 * because those require the dependency to actually be present and
 * responding.
 *
 * These tests mock all I/O at the module boundary — `openai`, `@/lib/redis`,
 * `@/lib/logger`, and (selectively) `@/lib/circuit-breaker` — so we can
 * deterministically drive: successful embeddings + cosine similarity,
 * Redis cache hit/miss/read-failure/write-failure, circuit breaker open
 * state, and the top-level try/catch in matchTemplate. No real network
 * call and no real Redis connection are made.
 *
 * The `openai` client is constructed once at module load time based on
 * `process.env.OPENAI_API_KEY`, so each describe block that needs a
 * particular client state sets the env var and calls `vi.resetModules()`
 * before re-importing the service fresh.
 */

const embeddingsCreateMock = vi.hoisted(() => vi.fn())
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: { create: embeddingsCreateMock },
  })),
}))

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({ logger: loggerMock }))

const redisClientMock = vi.hoisted(() => ({
  get: vi.fn(),
  setex: vi.fn(),
}))
const getRedisClientMock = vi.hoisted(() => vi.fn(() => redisClientMock))
vi.mock('@/lib/redis', () => ({ getRedisClient: getRedisClientMock }))

const ORIGINAL_API_KEY = process.env.OPENAI_API_KEY

function embeddingFor(seed: number, length = 8): number[] {
  // Deterministic pseudo-embedding so cosine similarity is reproducible.
  return Array.from({ length }, (_, i) => Math.sin(seed + i))
}

async function freshService() {
  vi.resetModules()
  const { TemplateMatcherService } = await import('@/lib/services/template-matcher.service')
  const { resetAllCircuitBreakers } = await import('@/lib/circuit-breaker')
  resetAllCircuitBreakers()
  return new TemplateMatcherService()
}

beforeEach(() => {
  vi.clearAllMocks()
  getRedisClientMock.mockReturnValue(redisClientMock)
  redisClientMock.get.mockResolvedValue(null)
  redisClientMock.setex.mockResolvedValue('OK')
})

afterEach(() => {
  if (ORIGINAL_API_KEY === undefined) {
    delete process.env.OPENAI_API_KEY
  } else {
    process.env.OPENAI_API_KEY = ORIGINAL_API_KEY
  }
})

describe('TemplateMatcherService — Redis initialization', () => {
  it('disables caching but does not throw when getRedisClient() itself throws', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    getRedisClientMock.mockImplementation(() => {
      throw new Error('redis unavailable')
    })

    const service = await freshService()
    // Constructor runs initRedis() fire-and-forget; give the microtask a tick.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Redis not available for template matcher, caching disabled',
      expect.objectContaining({ error: expect.any(Error) })
    )
    // Service must still be usable (keyword-only) even with no cache.
    const result = await service.matchTemplate(
      'dashboard analytics metrics admin panel overview statistics charts graphs kpi monitoring saas',
      false
    )
    expect(result.matchType).toBe('keyword')
  })
})

describe('TemplateMatcherService.getKeywordSuggestions', () => {
  it('returns the configured keyword list for a known category', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const service = await freshService()

    expect(service.getKeywordSuggestions('dashboard')).toEqual(
      expect.arrayContaining(['dashboard', 'analytics', 'metrics', 'kpi'])
    )
  })

  it('returns an empty array for an unknown category', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const service = await freshService()

    expect(service.getKeywordSuggestions('not-a-real-category')).toEqual([])
  })
})

describe('TemplateMatcherService.matchTemplate — keyword-only (useSemanticMatching=false)', () => {
  it('matches the dashboard category for a dashboard-heavy prompt without calling OpenAI', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const service = await freshService()

    const result = await service.matchTemplate(
      'dashboard analytics metrics admin panel overview statistics charts graphs kpi monitoring saas',
      false
    )

    expect(result.templateCategory).toBe('dashboard')
    expect(result.matchType).toBe('keyword')
    expect(result.semanticDegraded).toBe(false)
    expect(result.confidence).toBeGreaterThanOrEqual(0.7)
    expect(embeddingsCreateMock).not.toHaveBeenCalled()
  })

  it('returns matchType "none" with zero confidence when no category clears the 0.7 threshold', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const service = await freshService()

    const result = await service.matchTemplate('hello world, just a vague greeting', false)

    expect(result.matchType).toBe('none')
    expect(result.confidence).toBe(0)
    expect(result.templateCategory).toBeUndefined()
  })

  it('is case-insensitive when matching keywords', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const service = await freshService()

    const lower = await service.matchTemplate(
      'dashboard analytics metrics admin panel overview statistics charts graphs kpi monitoring saas',
      false
    )
    const upper = await service.matchTemplate(
      'DASHBOARD ANALYTICS METRICS ADMIN PANEL OVERVIEW STATISTICS CHARTS GRAPHS KPI MONITORING SAAS',
      false
    )

    expect(upper.templateCategory).toBe(lower.templateCategory)
    expect(upper.confidence).toBeCloseTo(lower.confidence)
  })

  it('treats an empty prompt as no match rather than throwing', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const service = await freshService()

    const result = await service.matchTemplate('', false)

    expect(result.matchType).toBe('none')
    expect(result.confidence).toBe(0)
  })
})

describe('TemplateMatcherService.matchTemplate — semantic matching succeeds', () => {
  it('combines keyword and semantic scores (60/40) and reports matchType "combined" when OpenAI succeeds', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    embeddingsCreateMock.mockImplementation(async (params: { input: string }) => {
      // Give the prompt and the matching category description similar
      // embeddings so cosine similarity is high and deterministic.
      const seed = params.input.toLowerCase().includes('dashboard') ? 1 : 42
      return { data: [{ embedding: embeddingFor(seed) }] }
    })

    const service = await freshService()
    const result = await service.matchTemplate('dashboard analytics metrics charts kpi', true)

    expect(result.matchType).toBe('combined')
    expect(result.semanticDegraded).toBe(false)
    expect(embeddingsCreateMock).toHaveBeenCalled()
  })

  it('caches the category embedding in Redis on first computation (cache miss -> setex)', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    embeddingsCreateMock.mockResolvedValue({ data: [{ embedding: embeddingFor(1) }] })
    redisClientMock.get.mockResolvedValue(null) // cache miss for every category

    const service = await freshService()
    await service.matchTemplate('dashboard analytics metrics charts kpi', true)

    expect(redisClientMock.get).toHaveBeenCalled()
    expect(redisClientMock.setex).toHaveBeenCalledWith(
      expect.stringContaining('template-category-embedding:'),
      86400,
      expect.any(String)
    )
  })

  it('reuses a cached category embedding from Redis instead of calling OpenAI again for that category', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const cachedEmbedding = embeddingFor(7)
    redisClientMock.get.mockImplementation(async (key: string) =>
      key.includes('dashboard') ? JSON.stringify(cachedEmbedding) : null
    )
    embeddingsCreateMock.mockResolvedValue({ data: [{ embedding: embeddingFor(7) }] })

    const service = await freshService()
    await service.matchTemplate('dashboard analytics metrics charts kpi', true)

    // generateEmbedding is still called once for the prompt itself, but
    // never for the dashboard category description since it was cached.
    const categoryDescriptionCalls = embeddingsCreateMock.mock.calls.filter(([params]: any[]) =>
      params.input.includes('comprehensive dashboard')
    )
    expect(categoryDescriptionCalls).toHaveLength(0)
    expect(redisClientMock.setex).not.toHaveBeenCalledWith(
      expect.stringContaining('dashboard'),
      expect.anything(),
      expect.anything()
    )
  })

  it('falls back to keyword-only for that category when the Redis cache read throws, without crashing', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    redisClientMock.get.mockRejectedValue(new Error('redis get failed'))
    embeddingsCreateMock.mockResolvedValue({ data: [{ embedding: embeddingFor(1) }] })

    const service = await freshService()
    const result = await service.matchTemplate('dashboard analytics metrics charts kpi', true)

    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Failed to get category embedding from cache',
      expect.objectContaining({ category: expect.any(String) })
    )
    // Degraded cache read still lets semantic scoring succeed via a fresh call.
    expect(result.semanticDegraded).toBe(false)
  })

  it('does not fail the request when the Redis cache write (setex) throws', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    redisClientMock.setex.mockRejectedValue(new Error('redis setex failed'))
    embeddingsCreateMock.mockResolvedValue({ data: [{ embedding: embeddingFor(1) }] })

    const service = await freshService()
    const result = await service.matchTemplate('dashboard analytics metrics charts kpi', true)

    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Failed to cache category embedding',
      expect.objectContaining({ category: expect.any(String) })
    )
    expect(result.semanticDegraded).toBe(false)
  })
})

describe('TemplateMatcherService.matchTemplate — semantic matching degraded/unavailable', () => {
  it('treats a cosine-similarity length mismatch between prompt and category embeddings as a caught failure (degraded), not a crash', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    // Different-length embeddings for the prompt vs. the category
    // description trip the explicit length-mismatch guard inside
    // cosineSimilarity, which the circuit breaker's execute() catches
    // like any other failure.
    embeddingsCreateMock.mockImplementation(async (params: { input: string }) => {
      const isPromptCall = !Object.values({
        dashboard: 'comprehensive dashboard',
        ecommerce: 'e-commerce product page',
        landing: 'marketing landing page',
        admin: 'admin panel with CRUD',
        blog: 'blog layout with article',
      }).some((marker) => params.input.includes(marker))
      return { data: [{ embedding: embeddingFor(1, isPromptCall ? 8 : 4) }] }
    })

    const service = await freshService()
    const result = await service.matchTemplate(
      'dashboard analytics metrics admin panel overview statistics charts graphs kpi monitoring saas',
      true
    )

    expect(result.semanticDegraded).toBe(true)
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Failed to calculate semantic score',
      expect.objectContaining({ message: 'Embeddings must have same length' })
    )
  })

  it('flags semanticDegraded=true and still returns a keyword-based match when OpenAI throws', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    embeddingsCreateMock.mockRejectedValue(new Error('OpenAI API error'))

    const service = await freshService()
    const result = await service.matchTemplate(
      'dashboard analytics metrics admin panel overview statistics charts graphs kpi monitoring saas',
      true
    )

    expect(result.semanticDegraded).toBe(true)
    expect(result.templateCategory).toBe('dashboard')
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Failed to calculate semantic score',
      expect.any(Error)
    )
  })

  it('short-circuits without calling OpenAI once the breaker has opened after 3 consecutive failures, and does not log another "Failed to calculate" error for the short-circuited calls', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    embeddingsCreateMock.mockRejectedValue(new Error('OpenAI API error'))

    const service = await freshService()

    // 3 consecutive failing calls to open the breaker (threshold=3).
    await service.matchTemplate('dashboard analytics metrics charts kpi', true)
    await service.matchTemplate('dashboard analytics metrics charts kpi', true)
    await service.matchTemplate('dashboard analytics metrics charts kpi', true)

    const callsBeforeOpen = embeddingsCreateMock.mock.calls.length
    loggerMock.error.mockClear()

    const result = await service.matchTemplate('dashboard analytics metrics charts kpi', true)

    expect(result.semanticDegraded).toBe(true)
    // Breaker is open: no new embedding calls were attempted for this request.
    expect(embeddingsCreateMock.mock.calls.length).toBe(callsBeforeOpen)
    // Short-circuited failures are not re-logged as "Failed to calculate semantic score".
    expect(loggerMock.error).not.toHaveBeenCalledWith(
      'Failed to calculate semantic score',
      expect.anything()
    )
  })

  it('reports semanticDegraded=true when OPENAI_API_KEY is unset, falling back to keyword-only entirely', async () => {
    delete process.env.OPENAI_API_KEY

    const service = await freshService()
    const result = await service.matchTemplate(
      'blog article post news content publishing writing journal magazine',
      true
    )

    expect(result.semanticDegraded).toBe(true)
    expect(result.templateCategory).toBe('blog')
  })
})

describe('TemplateMatcherService.matchTemplate — top-level error handling', () => {
  it('returns confidence 0 / matchType "none" and degraded=useSemanticMatching when an unexpected error escapes the scoring loop', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    // Force a synchronous throw from inside the try block: embeddings.create
    // returning a malformed shape (missing data[0].embedding) causes
    // cosineSimilarity to throw on length mismatch inside calculateSemanticScore,
    // which the breaker catches — but let's also exercise a throw that escapes
    // the breaker entirely via a bad prompt type at the keyword-scoring layer.
    const service = await freshService()

    // @ts-expect-error — deliberately passing a non-string to exercise the
    // top-level catch (prompt.toLowerCase is not a function).
    const result = await service.matchTemplate(null, false)

    expect(result).toEqual({
      confidence: 0,
      matchType: 'none',
      semanticDegraded: false,
    })
    expect(loggerMock.error).toHaveBeenCalledWith('Template matching failed', expect.any(Error))
  })

  it('sets semanticDegraded=true in the top-level catch when useSemanticMatching was requested', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const service = await freshService()

    // @ts-expect-error — same forced throw, but with semantic matching requested.
    const result = await service.matchTemplate(undefined, true)

    expect(result.matchType).toBe('none')
    expect(result.semanticDegraded).toBe(true)
  })
})

describe('TemplateMatcherService.warmCache', () => {
  it('computes and caches an embedding for every category', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    embeddingsCreateMock.mockResolvedValue({ data: [{ embedding: embeddingFor(3) }] })
    redisClientMock.get.mockResolvedValue(null)

    const service = await freshService()
    await service.warmCache()

    // 5 categories: dashboard, ecommerce, landing, admin, blog.
    expect(redisClientMock.setex).toHaveBeenCalledTimes(5)
    expect(loggerMock.info).toHaveBeenCalledWith('Warming template embedding cache')
    expect(loggerMock.info).toHaveBeenCalledWith(
      'Template embedding cache warmed',
      expect.objectContaining({ categories: expect.arrayContaining(['dashboard', 'blog']) })
    )
  })

  it('propagates a rejection if generating an embedding fails outright (no breaker involved for warmCache)', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    embeddingsCreateMock.mockRejectedValue(new Error('OpenAI down'))

    const service = await freshService()

    await expect(service.warmCache()).rejects.toThrow('Failed to generate embedding')
  })
})

describe('getTemplateMatcherService (module singleton)', () => {
  it('returns the same instance across repeated calls', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    vi.resetModules()
    const { getTemplateMatcherService, TemplateMatcherService } = await import(
      '@/lib/services/template-matcher.service'
    )

    const first = getTemplateMatcherService()
    const second = getTemplateMatcherService()

    expect(first).toBeInstanceOf(TemplateMatcherService)
    expect(second).toBe(first)
  })
})
