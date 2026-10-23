import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BedrockClient, isBedrockEnabled, resolveBedrockModelId } from '@/lib/bedrock-client'

describe('bedrock-client — provider-aware response normalization (builder#895)', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('isBedrockEnabled requires both the flag and the bearer token', () => {
    expect(isBedrockEnabled({ CODY_USE_BEDROCK: '1', AWS_BEARER_TOKEN_BEDROCK: 'x' } as any)).toBe(true)
    expect(isBedrockEnabled({ CODY_USE_BEDROCK: '1' } as any)).toBe(false)
    expect(isBedrockEnabled({ AWS_BEARER_TOKEN_BEDROCK: 'x' } as any)).toBe(false)
  })

  it('resolveBedrockModelId falls back to the verified Sonnet 4.5 profile', () => {
    expect(resolveBedrockModelId({} as any)).toBe('us.anthropic.claude-sonnet-4-5-20250929-v1:0')
    expect(resolveBedrockModelId({ BEDROCK_MODEL_ID: 'custom-profile' } as any)).toBe('custom-profile')
  })

  it('parses a Claude-shaped response unchanged', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'hello from claude' }],
        usage: { input_tokens: 8, output_tokens: 5 },
        stop_reason: 'end_turn',
        model: 'claude-sonnet-4-6',
      }),
    }) as any

    const client = new BedrockClient({
      AWS_BEARER_TOKEN_BEDROCK: 'token',
      BEDROCK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6',
    } as any)

    const res = await client.messages.create({
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(res.content).toEqual([{ type: 'text', text: 'hello from claude' }])
    expect(res.usage).toEqual({ input_tokens: 8, output_tokens: 5 })
  })

  it('normalizes an OpenAI-shaped response (Kimi/MiniMax/GLM) into the Claude shape', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'hello from kimi' },
          },
        ],
        usage: { prompt_tokens: 28, completion_tokens: 10, total_tokens: 38 },
        model: 'moonshotai.kimi-k2.5',
      }),
    }) as any

    const client = new BedrockClient({
      AWS_BEARER_TOKEN_BEDROCK: 'token',
      BEDROCK_MODEL_ID: 'moonshotai.kimi-k2.5',
    } as any)

    const res = await client.messages.create({
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(res.content).toEqual([{ type: 'text', text: 'hello from kimi' }])
    expect(res.usage).toEqual({ input_tokens: 28, output_tokens: 10 })
    expect(res.stop_reason).toBe('stop')
  })

  it('normalizes an OpenAI-shaped response for minimax and glm model IDs too', async () => {
    const cases = [
      { model: 'minimax.minimax-m2', content: 'hello from minimax' },
      { model: 'zai.glm-5', content: 'hello from glm' },
    ]

    for (const { model, content } of cases) {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
          usage: { prompt_tokens: 6, completion_tokens: 10, total_tokens: 16 },
          model,
        }),
      }) as any

      const client = new BedrockClient({
        AWS_BEARER_TOKEN_BEDROCK: 'token',
        BEDROCK_MODEL_ID: model,
      } as any)

      const res = await client.messages.create({
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      })

      expect(res.content).toEqual([{ type: 'text', text: content }])
      expect(res.usage).toEqual({ input_tokens: 6, output_tokens: 10 })
    }
  })

  it('returns empty content (not a throw) when an OpenAI-shaped response has no choices', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 0 } }),
    }) as any

    const client = new BedrockClient({
      AWS_BEARER_TOKEN_BEDROCK: 'token',
      BEDROCK_MODEL_ID: 'moonshotai.kimi-k2.5',
    } as any)

    const res = await client.messages.create({
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(res.content).toEqual([])
  })

  it('throws with response detail on a non-ok HTTP status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'not available for this account',
    }) as any

    const client = new BedrockClient({
      AWS_BEARER_TOKEN_BEDROCK: 'token',
      BEDROCK_MODEL_ID: 'us.anthropic.claude-opus-4-7',
    } as any)

    await expect(
      client.messages.create({ max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/403/)
  })
})

describe('bedrock-client — bounded timeout (builder#1253)', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  /**
   * Real, live production bug (builder#1253): POST /api/chat-ws returned
   * HTTP 200 (the SSE stream started), but the client never saw a terminal
   * event and the workspace preview sat on "Cody is building your app..."
   * for 4+ minutes with zero further client-visible network activity.
   *
   * Root cause: this file's fetch() to the Bedrock runtime endpoint — the
   * PRIMARY codegen call under Config C — carried no AbortSignal, unlike
   * every other upstream call in this codebase (lib/zerodb-store.ts,
   * lib/agent/zeromemory.ts, lib/build/committee-runner.ts, etc. — see that
   * file's own stated doctrine: "every call is time-boxed ... so a hung
   * vendor can never [hang the pipeline]"). A Bedrock connection that stalls
   * with no response and no connection-level error left `await fetch(...)`
   * pending forever: chat-ws's SSE stream never reached any of its
   * controller.close() call sites, so the client's reader.read() never saw
   * `done`. This test proves the call is now genuinely bounded — a fetch
   * that hangs forever (never resolves, never rejects) still surfaces as a
   * normal, catchable rejection within the configured timeout, instead of
   * blocking the caller indefinitely.
   */
  it('passes an AbortSignal to fetch so a hung connection cannot block forever', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }),
    })
    global.fetch = fetchMock as any

    const client = new BedrockClient({
      AWS_BEARER_TOKEN_BEDROCK: 'token',
      BEDROCK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6',
    } as any)

    await client.messages.create({ max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal)
  })

  it('converts a timed-out/aborted fetch into a clean, catchable Error instead of hanging', async () => {
    // Simulate exactly what AbortSignal.timeout() produces when it fires on a
    // genuinely hung connection: fetch rejects with a DOMException/Error named
    // 'TimeoutError' (or 'AbortError' depending on the runtime).
    global.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }),
    ) as any

    const client = new BedrockClient({
      AWS_BEARER_TOKEN_BEDROCK: 'token',
      BEDROCK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6',
    } as any)

    await expect(
      client.messages.create({ max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/timed out/i)
  })

  it('still propagates a genuine non-timeout fetch failure unchanged (e.g. DNS/network error)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND bedrock-runtime')) as any

    const client = new BedrockClient({
      AWS_BEARER_TOKEN_BEDROCK: 'token',
      BEDROCK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6',
    } as any)

    await expect(
      client.messages.create({ max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/ENOTFOUND/)
  })
})
