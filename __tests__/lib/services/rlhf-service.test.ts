import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Unit tests for rlhf.service.ts: logs generations/feedback into ZeroDB
 * (delegated to zerodb-rlhf.service, mocked here) and best-effort feeds the
 * AINative intelligence loop via a direct fetch call that is caught and
 * swallowed on failure, by design, so logGeneration/logGenerationFailure
 * never reject even when every downstream call fails.
 */

const getInsightsFromZeroDBMock = vi.hoisted(() => vi.fn())
const submitFeedbackToZeroDBMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/zerodb-rlhf.service', () => ({
  getInsightsFromZeroDB: getInsightsFromZeroDBMock,
  submitFeedbackToZeroDB: submitFeedbackToZeroDBMock,
}))

const getAinativeApiKeyMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/build/env-keys', () => ({
  getAinativeApiKey: getAinativeApiKeyMock,
}))

describe('logGeneration', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  beforeEach(() => {
    vi.clearAllMocks()
    getAinativeApiKeyMock.mockReturnValue('api-key')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any
  })

  it('returns a generated UUID immediately regardless of downstream outcomes', async () => {
    const { logGeneration } = await import('@/lib/services/rlhf.service')

    const id = await logGeneration({
      chatId: 'chat-1',
      userId: 'user-1',
      prompt: 'build a form',
      generatedCode: '<form></form>',
      model: 'claude-sonnet-4',
      generationTimeMs: 1200,
    })

    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('never rejects even when the ZeroDB write and the intelligence-loop fetch both fail', async () => {
    getAinativeApiKeyMock.mockReturnValue('api-key')
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any
    const { logGeneration } = await import('@/lib/services/rlhf.service')

    await expect(
      logGeneration({
        chatId: 'chat-1',
        userId: 'user-1',
        prompt: 'build a form',
        generatedCode: '<form></form>',
        model: 'claude-sonnet-4',
        generationTimeMs: 1200,
      })
    ).resolves.toBeTruthy()
  })

  it('includes agent-powered fields in the intelligence-loop payload when agentPowered is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    global.fetch = fetchMock as any

    const { logGeneration } = await import('@/lib/services/rlhf.service')
    await logGeneration({
      chatId: 'chat-agent',
      userId: 'user-1',
      prompt: 'build an app',
      generatedCode: 'code',
      model: 'claude-sonnet-4',
      generationTimeMs: 5000,
      agentPowered: true,
      agentTurns: 3,
      agentBuildPassed: true,
      agentToolsUsed: ['bash', 'edit'],
      agentFallback: false,
      agentDurationMs: 4800,
    })

    // Allow the fire-and-forget logGenerationToZeroDB promise to run.
    await new Promise((resolve) => setTimeout(resolve, 0))

    const zerodbCall = fetchMock.mock.calls.find((c: any) =>
      String(c[0]).includes('rlhf_training_data')
    )
    expect(zerodbCall).toBeTruthy()
    const body = JSON.parse(zerodbCall![1].body)
    expect(body.row_data.chat_id).toBe('chat-agent')
    expect(body.row_data.model).toBe('claude-sonnet-4')
  })

  it('does not throw when no API key is configured (ZeroDB + intelligence loop both skip)', async () => {
    getAinativeApiKeyMock.mockReturnValue('')
    const { logGeneration } = await import('@/lib/services/rlhf.service')

    await expect(
      logGeneration({
        chatId: 'chat-1',
        userId: 'user-1',
        prompt: 'x',
        generatedCode: 'y',
        model: 'm',
        generationTimeMs: 100,
      })
    ).resolves.toBeTruthy()
  })
})

describe('logGenerationFailure', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  beforeEach(() => {
    vi.clearAllMocks()
    getAinativeApiKeyMock.mockReturnValue('api-key')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any
  })

  it('resolves without throwing even though it performs no return value', async () => {
    const { logGenerationFailure } = await import('@/lib/services/rlhf.service')

    await expect(
      logGenerationFailure({
        chatId: 'chat-1',
        userId: 'user-1',
        prompt: 'x',
        model: 'm',
        error: 'boom',
        generationTimeMs: 50,
      })
    ).resolves.toBeUndefined()
  })

  it('still resolves cleanly when the ZeroDB fetch rejects', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('timeout')) as any
    const { logGenerationFailure } = await import('@/lib/services/rlhf.service')

    await expect(
      logGenerationFailure({
        chatId: 'chat-1',
        userId: 'user-1',
        prompt: 'x',
        model: 'm',
        error: 'boom',
        generationTimeMs: 50,
      })
    ).resolves.toBeUndefined()
  })
})

describe('submitFeedback', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  beforeEach(() => {
    vi.clearAllMocks()
    getAinativeApiKeyMock.mockReturnValue('api-key')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any
  })

  it('delegates to submitFeedbackToZeroDB and returns its id', async () => {
    submitFeedbackToZeroDBMock.mockResolvedValue('feedback-id-123')
    const { submitFeedback } = await import('@/lib/services/rlhf.service')

    const id = await submitFeedback({
      generationId: 'gen-1',
      rating: 5,
      wasEdited: false,
      iterations: 1,
    })

    expect(id).toBe('feedback-id-123')
    expect(submitFeedbackToZeroDBMock).toHaveBeenCalledWith(
      expect.objectContaining({ generationId: 'gen-1', rating: 5 })
    )
  })

  it('returns a placeholder id instead of throwing when submitFeedbackToZeroDB rejects', async () => {
    submitFeedbackToZeroDBMock.mockRejectedValue(new Error('zerodb write failed'))
    const { submitFeedback } = await import('@/lib/services/rlhf.service')

    const id = await submitFeedback({
      generationId: 'gen-1',
      rating: 2,
      wasEdited: true,
      iterations: 3,
    })

    expect(id).toBe('feedback-placeholder')
  })
})

describe('getInsights', () => {
  it('delegates directly to getInsightsFromZeroDB and returns its result verbatim', async () => {
    const fakeResponse = {
      summary: {
        avgRating: 4.2,
        totalGenerations: 10,
        firstPassSuccessRate: 80,
        editRate: 20,
        avgGenerationTimeMs: 1500,
        p50LatencyMs: 1200,
        p95LatencyMs: 3000,
        p99LatencyMs: 5000,
      },
      breakdown: [],
    }
    getInsightsFromZeroDBMock.mockResolvedValue(fakeResponse)
    const { getInsights } = await import('@/lib/services/rlhf.service')

    const result = await getInsights({ timeRange: '7d' })
    expect(result).toBe(fakeResponse)
    expect(getInsightsFromZeroDBMock).toHaveBeenCalledWith({ timeRange: '7d' })
  })
})

describe('getActivePromptVersion', () => {
  it('always returns null (prompt_versions migrated off Drizzle)', async () => {
    const { getActivePromptVersion } = await import('@/lib/services/rlhf.service')
    const result = await getActivePromptVersion('system')
    expect(result).toBeNull()
  })
})
