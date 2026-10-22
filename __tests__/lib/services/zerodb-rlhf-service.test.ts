import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Unit tests for zerodb-rlhf.service.ts: reads/writes RLHF training and
 * feedback data from ZeroDB over global `fetch`. Exercises the aggregation
 * logic in getInsightsFromZeroDB (date-range filtering, rating merge,
 * first-pass/edit rates, latency percentiles, groupBy breakdowns) and the
 * best-effort write path in submitFeedbackToZeroDB.
 */

vi.mock('@/lib/build/env-keys', () => ({
  getAinativeApiKey: () => 'test-api-key',
}))

// Millisecond-precision offset — Date#setDate/getDate truncate fractional
// day arguments, which made a 0.1-day ("a few hours ago") offset unreliable
// right at the getInsightsFromZeroDB start-of-range boundary.
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('getInsightsFromZeroDB', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })
  beforeEach(() => vi.clearAllMocks())

  function mockTrainingAndFeedback(trainingRows: any[], feedbackRows: any[] = []) {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('rlhf_training_data')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: trainingRows.map((r) => ({ row_data: r })) }) })
      }
      if (url.includes('rlhf_feedback')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: feedbackRows.map((r) => ({ row_data: r })) }) })
      }
      return Promise.resolve({ ok: false, status: 404 })
    }) as any
  }

  it('returns an all-zero summary when there are no rows at all', async () => {
    mockTrainingAndFeedback([])
    const { getInsightsFromZeroDB } = await import('@/lib/services/zerodb-rlhf.service')

    const result = await getInsightsFromZeroDB({ timeRange: '7d' })

    expect(result.summary.totalGenerations).toBe(0)
    expect(result.summary.avgRating).toBe(0)
    expect(result.breakdown).toEqual([])
  })

  it('filters rows outside the requested time range (1d) client-side', async () => {
    mockTrainingAndFeedback([
      { chat_id: 'c1', created_at: isoDaysAgo(0.1), generation_time_ms: 1000, validation_valid: true },
      { chat_id: 'c2', created_at: isoDaysAgo(5), generation_time_ms: 2000, validation_valid: true },
    ])
    const { getInsightsFromZeroDB } = await import('@/lib/services/zerodb-rlhf.service')

    const result = await getInsightsFromZeroDB({ timeRange: '1d' })
    expect(result.summary.totalGenerations).toBe(1)
  })

  it('merges feedback ratings by chat_id and computes avgRating only from rated rows', async () => {
    mockTrainingAndFeedback(
      [
        { chat_id: 'c1', created_at: isoDaysAgo(1), generation_time_ms: 1000, validation_valid: true },
        { chat_id: 'c2', created_at: isoDaysAgo(1), generation_time_ms: 2000, validation_valid: true },
      ],
      [
        { chat_id: 'c1', rating: 5 },
        { chat_id: 'c2', rating: 3 },
      ]
    )
    const { getInsightsFromZeroDB } = await import('@/lib/services/zerodb-rlhf.service')

    const result = await getInsightsFromZeroDB({ timeRange: '7d' })
    expect(result.summary.avgRating).toBe(4)
  })

  it('computes firstPassSuccessRate from rows rated >=4 with valid validation', async () => {
    mockTrainingAndFeedback(
      [
        { chat_id: 'c1', created_at: isoDaysAgo(1), generation_time_ms: 500, validation_valid: true },
        { chat_id: 'c2', created_at: isoDaysAgo(1), generation_time_ms: 500, validation_valid: true },
        { chat_id: 'c3', created_at: isoDaysAgo(1), generation_time_ms: 500, validation_valid: false },
        { chat_id: 'c4', created_at: isoDaysAgo(1), generation_time_ms: 500, validation_valid: true },
      ],
      [
        { chat_id: 'c1', rating: 5 },
        { chat_id: 'c2', rating: 2 },
        { chat_id: 'c3', rating: 5 },
        // c4 unrated
      ]
    )
    const { getInsightsFromZeroDB } = await import('@/lib/services/zerodb-rlhf.service')

    const result = await getInsightsFromZeroDB({ timeRange: '30d' })
    // Only c1 qualifies: rating >= 4 AND validation_valid !== false.
    expect(result.summary.firstPassSuccessRate).toBe(25)
  })

  it('computes editRate from rows with retry_attempted set', async () => {
    mockTrainingAndFeedback([
      { chat_id: 'c1', created_at: isoDaysAgo(1), generation_time_ms: 100, retry_attempted: true },
      { chat_id: 'c2', created_at: isoDaysAgo(1), generation_time_ms: 100, retry_attempted: false },
      { chat_id: 'c3', created_at: isoDaysAgo(1), generation_time_ms: 100, retry_attempted: true },
      { chat_id: 'c4', created_at: isoDaysAgo(1), generation_time_ms: 100 },
    ])
    const { getInsightsFromZeroDB } = await import('@/lib/services/zerodb-rlhf.service')

    const result = await getInsightsFromZeroDB({ timeRange: '30d' })
    expect(result.summary.editRate).toBe(50)
  })

  it('calculates latency percentiles (p50/p95/p99) from generation_time_ms', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      chat_id: `c${i}`,
      created_at: isoDaysAgo(1),
      generation_time_ms: (i + 1) * 100,
    }))
    mockTrainingAndFeedback(rows)
    const { getInsightsFromZeroDB } = await import('@/lib/services/zerodb-rlhf.service')

    const result = await getInsightsFromZeroDB({ timeRange: '30d' })
    expect(result.summary.avgGenerationTimeMs).toBe(550)
    expect(result.summary.p50LatencyMs).toBeGreaterThan(0)
    expect(result.summary.p95LatencyMs).toBeGreaterThanOrEqual(result.summary.p50LatencyMs)
  })

  it('groups the breakdown by model when groupBy is "model"', async () => {
    mockTrainingAndFeedback([
      { chat_id: 'c1', created_at: isoDaysAgo(1), generation_time_ms: 100, model: 'claude-sonnet-4' },
      { chat_id: 'c2', created_at: isoDaysAgo(1), generation_time_ms: 200, model: 'claude-sonnet-4' },
      { chat_id: 'c3', created_at: isoDaysAgo(1), generation_time_ms: 300, model: 'claude-opus-4' },
    ])
    const { getInsightsFromZeroDB } = await import('@/lib/services/zerodb-rlhf.service')

    const result = await getInsightsFromZeroDB({ timeRange: '30d', groupBy: 'model' })
    const keys = result.breakdown.map((b) => b.key).sort()
    expect(keys).toEqual(['claude-opus-4', 'claude-sonnet-4'])
    const sonnet = result.breakdown.find((b) => b.key === 'claude-sonnet-4')
    expect(sonnet?.count).toBe(2)
  })

  it('groups the breakdown by template when groupBy is "template", defaulting to "none"', async () => {
    mockTrainingAndFeedback([
      { chat_id: 'c1', created_at: isoDaysAgo(1), generation_time_ms: 100, template_used: 'dashboard' },
      { chat_id: 'c2', created_at: isoDaysAgo(1), generation_time_ms: 100 },
    ])
    const { getInsightsFromZeroDB } = await import('@/lib/services/zerodb-rlhf.service')

    const result = await getInsightsFromZeroDB({ timeRange: '30d', groupBy: 'template' })
    const keys = result.breakdown.map((b) => b.key).sort()
    expect(keys).toEqual(['dashboard', 'none'])
  })

  it('groups the breakdown by day when groupBy is "day"', async () => {
    mockTrainingAndFeedback([
      { chat_id: 'c1', created_at: isoDaysAgo(1), generation_time_ms: 100 },
    ])
    const { getInsightsFromZeroDB } = await import('@/lib/services/zerodb-rlhf.service')

    const result = await getInsightsFromZeroDB({ timeRange: '30d', groupBy: 'day' })
    expect(result.breakdown).toHaveLength(1)
    expect(result.breakdown[0].key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('groups the breakdown by week when groupBy is "week"', async () => {
    mockTrainingAndFeedback([
      { chat_id: 'c1', created_at: isoDaysAgo(1), generation_time_ms: 100 },
    ])
    const { getInsightsFromZeroDB } = await import('@/lib/services/zerodb-rlhf.service')

    const result = await getInsightsFromZeroDB({ timeRange: '30d', groupBy: 'week' })
    expect(result.breakdown).toHaveLength(1)
    expect(result.breakdown[0].key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('groups the breakdown by month when groupBy is "month"', async () => {
    mockTrainingAndFeedback([
      { chat_id: 'c1', created_at: isoDaysAgo(1), generation_time_ms: 100 },
    ])
    const { getInsightsFromZeroDB } = await import('@/lib/services/zerodb-rlhf.service')

    const result = await getInsightsFromZeroDB({ timeRange: '30d', groupBy: 'month' })
    expect(result.breakdown).toHaveLength(1)
    expect(result.breakdown[0].key).toMatch(/^\d{4}-\d{2}$/)
  })

  it('returns an empty breakdown array when groupBy is not specified', async () => {
    mockTrainingAndFeedback([{ chat_id: 'c1', created_at: isoDaysAgo(1), generation_time_ms: 100 }])
    const { getInsightsFromZeroDB } = await import('@/lib/services/zerodb-rlhf.service')

    const result = await getInsightsFromZeroDB({ timeRange: '30d' })
    expect(result.breakdown).toEqual([])
  })

  it('treats a failed training-data fetch as zero rows (not a thrown error)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'down' }) as any
    const { getInsightsFromZeroDB } = await import('@/lib/services/zerodb-rlhf.service')

    const result = await getInsightsFromZeroDB({ timeRange: '7d' })
    expect(result.summary.totalGenerations).toBe(0)
  })

  it('treats a network-level fetch rejection as zero rows (not a thrown error)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as any
    const { getInsightsFromZeroDB } = await import('@/lib/services/zerodb-rlhf.service')

    const result = await getInsightsFromZeroDB({ timeRange: '7d' })
    expect(result.summary.totalGenerations).toBe(0)
  })
})

describe('submitFeedbackToZeroDB', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })
  beforeEach(() => vi.clearAllMocks())

  it('returns the id from a successful ZeroDB write', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: 'row-abc' } }),
    }) as any
    const { submitFeedbackToZeroDB } = await import('@/lib/services/zerodb-rlhf.service')

    const id = await submitFeedbackToZeroDB({
      generationId: 'gen-1',
      rating: 5,
      wasEdited: false,
      iterations: 1,
    })
    expect(id).toBe('row-abc')
  })

  it('returns a generated placeholder id when the write succeeds but omits an id', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }) as any
    const { submitFeedbackToZeroDB } = await import('@/lib/services/zerodb-rlhf.service')

    const id = await submitFeedbackToZeroDB({
      generationId: 'gen-1',
      rating: 4,
      wasEdited: false,
      iterations: 1,
    })
    expect(id).toMatch(/^zerodb-/)
  })

  it('returns a failure placeholder id when the ZeroDB write fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'error' }) as any
    const { submitFeedbackToZeroDB } = await import('@/lib/services/zerodb-rlhf.service')

    const id = await submitFeedbackToZeroDB({
      generationId: 'gen-1',
      rating: 1,
      wasEdited: true,
      iterations: 2,
    })
    expect(id).toMatch(/^feedback-placeholder-/)
  })

  it('serializes editChangesSummary into the row payload when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { id: 'row-1' } }) })
    global.fetch = fetchMock as any
    const { submitFeedbackToZeroDB } = await import('@/lib/services/zerodb-rlhf.service')

    await submitFeedbackToZeroDB({
      generationId: 'gen-1',
      rating: 5,
      wasEdited: true,
      iterations: 2,
      editChangesSummary: { linesAdded: 10, linesRemoved: 2 },
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(JSON.parse(body.row_data.edit_changes_summary)).toEqual({ linesAdded: 10, linesRemoved: 2 })
  })
})
