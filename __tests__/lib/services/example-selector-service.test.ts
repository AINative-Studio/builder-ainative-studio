import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Unit tests for example-selector.service.ts (US-029): semantic few-shot
 * example selection via OpenAI embeddings + cosine similarity, with a
 * random-fallback path when no examples clear the similarity threshold or
 * when anything upstream fails. I/O boundaries mocked: the `openai` SDK,
 * `db` (drizzle, named export from '../db/connection'), Redis caching, and
 * the logger.
 */

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const redisGetMock = vi.hoisted(() => vi.fn())
const redisSetexMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/redis', () => ({
  getRedisClient: () => ({ get: redisGetMock, setex: redisSetexMock }),
}))

const dbMock = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock('@/lib/db/connection', () => ({ db: dbMock }))
vi.mock('@/lib/db/schema', () => ({ few_shot_examples: {} }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn((a, b) => ({ a, b })) }))

const createEmbeddingMock = vi.hoisted(() => vi.fn())
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: { create: createEmbeddingMock },
  })),
}))

function selectWhereChain(rows: any[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) }
}
function selectNoWhereChain(rows: any[]) {
  return { from: () => Promise.resolve(rows) }
}

/** Builds an embedding vector that is maximally similar to `seed` (identical direction). */
function vec(...values: number[]): number[] {
  return values
}

const originalEnv = { ...process.env }

describe('selectExamplesBySimilarity', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OPENAI_API_KEY = 'sk-test'
    redisGetMock.mockResolvedValue(null)
    redisSetexMock.mockResolvedValue(undefined)
  })

  it('returns a fallback result when no examples exist for the category', async () => {
    dbMock.select.mockReturnValue(selectWhereChain([]))
    const { selectExamplesBySimilarity } = await import('@/lib/services/example-selector.service')

    const result = await selectExamplesBySimilarity('build a dashboard', 'dashboard')
    expect(result.method).toBe('fallback')
    expect(result.examples).toEqual([])
  })

  it('selects examples above the similarity threshold, sorted by score descending', async () => {
    dbMock.select.mockReturnValue(
      selectWhereChain([
        { id: 'ex-low', category: 'dashboard', prompt: 'low match example', good_output: 'x', explanation: 'x' },
        { id: 'ex-high', category: 'dashboard', prompt: 'high match example', good_output: 'y', explanation: 'y' },
      ])
    )

    // userEmbedding, then one embedding per example (low, high).
    createEmbeddingMock
      .mockResolvedValueOnce({ data: [{ embedding: vec(1, 0, 0) }] }) // user prompt
      .mockResolvedValueOnce({ data: [{ embedding: vec(0, 1, 0) }] }) // ex-low: orthogonal -> similarity 0
      .mockResolvedValueOnce({ data: [{ embedding: vec(1, 0, 0) }] }) // ex-high: identical -> similarity 1

    const { selectExamplesBySimilarity } = await import('@/lib/services/example-selector.service')
    const result = await selectExamplesBySimilarity('build a dashboard', 'dashboard')

    expect(result.method).toBe('semantic')
    expect(result.examples).toHaveLength(1)
    expect(result.examples[0].id).toBe('ex-high')
    expect(result.examples[0].similarityScore).toBeCloseTo(1, 5)
  })

  it('caps the selected examples at MAX_EXAMPLES (3) even when more clear the threshold', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `ex-${i}`,
      category: 'dashboard',
      prompt: `example ${i}`,
      good_output: 'x',
      explanation: 'x',
    }))
    dbMock.select.mockReturnValue(selectWhereChain(rows))

    createEmbeddingMock.mockResolvedValueOnce({ data: [{ embedding: vec(1, 0, 0) }] })
    for (let i = 0; i < 5; i++) {
      createEmbeddingMock.mockResolvedValueOnce({ data: [{ embedding: vec(1, 0, 0) }] })
    }

    const { selectExamplesBySimilarity } = await import('@/lib/services/example-selector.service')
    const result = await selectExamplesBySimilarity('build a dashboard', 'dashboard')

    expect(result.method).toBe('semantic')
    expect(result.examples.length).toBeLessThanOrEqual(3)
  })

  it('falls back to a random selection when no example clears the similarity threshold', async () => {
    dbMock.select.mockReturnValue(
      selectWhereChain([
        { id: 'ex-1', category: 'dashboard', prompt: 'unrelated', good_output: 'x', explanation: 'x' },
      ])
    )
    createEmbeddingMock
      .mockResolvedValueOnce({ data: [{ embedding: vec(1, 0, 0) }] }) // user
      .mockResolvedValueOnce({ data: [{ embedding: vec(0, 1, 0) }] }) // example, orthogonal -> 0 similarity

    const { selectExamplesBySimilarity } = await import('@/lib/services/example-selector.service')
    const result = await selectExamplesBySimilarity('build a dashboard', 'dashboard')

    expect(result.method).toBe('fallback')
    expect(result.examples[0].similarityScore).toBe(0)
  })

  it('selects without a category filter when none is provided', async () => {
    dbMock.select.mockReturnValue(selectNoWhereChain([]))
    const { selectExamplesBySimilarity } = await import('@/lib/services/example-selector.service')

    const result = await selectExamplesBySimilarity('build something')
    expect(result.method).toBe('fallback')
  })

  it('falls back to a random selection when OpenAI embedding generation throws', async () => {
    dbMock.select.mockReturnValue(
      selectWhereChain([
        { id: 'ex-1', category: 'dashboard', prompt: 'p', good_output: 'x', explanation: 'x' },
      ])
    )
    createEmbeddingMock.mockRejectedValue(new Error('rate limited'))

    const { selectExamplesBySimilarity } = await import('@/lib/services/example-selector.service')
    const result = await selectExamplesBySimilarity('build a dashboard', 'dashboard')

    expect(result.method).toBe('fallback')
  })

  it('falls back to a random selection when the OpenAI API key is not configured', async () => {
    delete process.env.OPENAI_API_KEY
    dbMock.select.mockReturnValue(
      selectWhereChain([
        { id: 'ex-1', category: 'dashboard', prompt: 'p', good_output: 'x', explanation: 'x' },
      ])
    )

    const { selectExamplesBySimilarity } = await import('@/lib/services/example-selector.service')
    const result = await selectExamplesBySimilarity('build a dashboard', 'dashboard')

    expect(result.method).toBe('fallback')
    expect(createEmbeddingMock).not.toHaveBeenCalled()
  })

  it('uses a cached embedding instead of calling OpenAI again for the same example', async () => {
    dbMock.select.mockReturnValue(
      selectWhereChain([
        { id: 'ex-1', category: 'dashboard', prompt: 'p', good_output: 'x', explanation: 'x' },
      ])
    )
    // User prompt has no cache key, so it always calls OpenAI once.
    createEmbeddingMock.mockResolvedValueOnce({ data: [{ embedding: vec(1, 0, 0) }] })
    redisGetMock.mockImplementation((key: string) => {
      if (key === 'embedding:ex-1') {
        return Promise.resolve(JSON.stringify(vec(1, 0, 0)))
      }
      return Promise.resolve(null)
    })

    const { selectExamplesBySimilarity } = await import('@/lib/services/example-selector.service')
    const result = await selectExamplesBySimilarity('build a dashboard', 'dashboard')

    // Only the user-prompt embedding call hit OpenAI; the example's came from cache.
    expect(createEmbeddingMock).toHaveBeenCalledTimes(1)
    expect(result.examples[0].similarityScore).toBeCloseTo(1, 5)
  })
})

describe('formatExamplesForPrompt', () => {
  it('returns an empty string for an empty examples array', async () => {
    const { formatExamplesForPrompt } = await import('@/lib/services/example-selector.service')
    expect(formatExamplesForPrompt([])).toBe('')
  })

  it('formats each example with its category, prompt, output, and explanation', async () => {
    const { formatExamplesForPrompt } = await import('@/lib/services/example-selector.service')

    const text = formatExamplesForPrompt([
      {
        id: 'ex-1',
        category: 'dashboard',
        prompt: 'build a KPI dashboard',
        good_output: '<div>KPI</div>',
        explanation: 'Clean layout',
        tags: [],
        created_at: new Date(),
        similarityScore: 0.9,
      } as any,
    ])

    expect(text).toContain('FEW-SHOT EXAMPLES')
    expect(text).toContain('EXAMPLE 1 (dashboard)')
    expect(text).toContain('build a KPI dashboard')
    expect(text).toContain('<div>KPI</div>')
    expect(text).toContain('Clean layout')
  })
})
