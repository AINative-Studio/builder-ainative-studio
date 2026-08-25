import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Tests for lib/build/claude-completion.ts — Claude provider resolver.
 *
 * Strategy: the module dynamically requires @anthropic-ai/sdk and reads
 * process.env at call time. We reset env + module cache between tests so
 * each describe block starts from a clean state.
 * All I/O (HTTP, SDK) is mocked — zero API budget.
 */

// We re-import fresh copies via dynamic import so env changes take effect.
// vi.resetModules() before each group clears the module cache.

const OLD_ENV = { ...process.env }

function clearBedrockEnv() {
  delete process.env.CODY_USE_BEDROCK
  delete process.env.AWS_BEARER_TOKEN_BEDROCK
  delete process.env.BEDROCK_MODEL_ID
  delete process.env.AWS_REGION
}

function clearAnthropicEnv() {
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.CLAUDE_MODEL
}

afterEach(() => {
  process.env = { ...OLD_ENV }
  vi.restoreAllMocks()
  vi.resetModules()
})

// ── isBedrockEnabled (indirectly via bedrock-client) ────────────────────────

describe('isBedrockEnabled', () => {
  it('is false when env vars are absent', async () => {
    clearBedrockEnv()
    vi.resetModules()
    const { isBedrockEnabled } = await import('@/lib/bedrock-client')
    expect(isBedrockEnabled()).toBe(false)
  })

  it('is false when CODY_USE_BEDROCK=1 but no token', async () => {
    clearBedrockEnv()
    process.env.CODY_USE_BEDROCK = '1'
    vi.resetModules()
    const { isBedrockEnabled } = await import('@/lib/bedrock-client')
    expect(isBedrockEnabled()).toBe(false)
  })

  it('is true when both CODY_USE_BEDROCK=1 and AWS_BEARER_TOKEN_BEDROCK are set', async () => {
    clearBedrockEnv()
    process.env.CODY_USE_BEDROCK = '1'
    process.env.AWS_BEARER_TOKEN_BEDROCK = 'my-bedrock-token'
    vi.resetModules()
    const { isBedrockEnabled } = await import('@/lib/bedrock-client')
    expect(isBedrockEnabled()).toBe(true)
  })
})

// ── resolveBedrockModelId ────────────────────────────────────────────────────

describe('resolveBedrockModelId', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('uses BEDROCK_MODEL_ID when explicitly set', async () => {
    process.env.BEDROCK_MODEL_ID = 'us.anthropic.my-model-v2:0'
    const { resolveBedrockModelId } = await import('@/lib/bedrock-client')
    expect(resolveBedrockModelId()).toBe('us.anthropic.my-model-v2:0')
  })

  it('falls back to the hardcoded sonnet profile when env is unset', async () => {
    delete process.env.BEDROCK_MODEL_ID
    const { resolveBedrockModelId } = await import('@/lib/bedrock-client')
    expect(resolveBedrockModelId()).toMatch(/us\.anthropic\.claude/)
  })
})

// ── getClaudeCompletion — Bedrock path ──────────────────────────────────────

describe('getClaudeCompletion — Bedrock path', () => {
  beforeEach(() => {
    vi.resetModules()
    clearBedrockEnv()
    clearAnthropicEnv()
    process.env.CODY_USE_BEDROCK = '1'
    process.env.AWS_BEARER_TOKEN_BEDROCK = 'bedrock-bearer'
  })

  it('returns provider=bedrock when Bedrock is configured', async () => {
    const mod = await import('@/lib/build/claude-completion')
    const c = mod.getClaudeCompletion()
    expect(c).not.toBeNull()
    expect(c!.provider).toBe('bedrock')
    expect(c!.label).toContain('Bedrock')
    expect(typeof c!.model).toBe('string')
    expect(c!.client).toBeDefined()
  })
})

// ── getClaudeCompletion — Anthropic direct path ─────────────────────────────

describe('getClaudeCompletion — Anthropic direct', () => {
  beforeEach(() => {
    vi.resetModules()
    clearBedrockEnv()
    clearAnthropicEnv()
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test1234'
  })

  it('returns provider=anthropic when only ANTHROPIC_API_KEY is set', async () => {
    // Mock the SDK so the require() inside anthropicDirect() doesn't fail.
    vi.mock('@anthropic-ai/sdk', () => ({
      default: class FakeAnthropic {
        constructor(public opts: any) {}
        messages = { create: vi.fn() }
      },
    }))
    const mod = await import('@/lib/build/claude-completion')
    const c = mod.getClaudeCompletion()
    expect(c).not.toBeNull()
    expect(c!.provider).toBe('anthropic')
    expect(c!.label).toContain('Claude')
    expect(c!.model).toBeTruthy()
  })
})

// ── getClaudeCompletion — no provider ───────────────────────────────────────

describe('getClaudeCompletion — no provider configured', () => {
  beforeEach(() => {
    vi.resetModules()
    clearBedrockEnv()
    clearAnthropicEnv()
  })

  it('returns null when neither Bedrock nor Anthropic is configured', async () => {
    const mod = await import('@/lib/build/claude-completion')
    const c = mod.getClaudeCompletion()
    expect(c).toBeNull()
  })
})

// ── completeText ────────────────────────────────────────────────────────────

describe('completeText', () => {
  beforeEach(() => {
    vi.resetModules()
    clearBedrockEnv()
    clearAnthropicEnv()
  })

  it('throws NO_CLAUDE_PROVIDER when no client is configured', async () => {
    const mod = await import('@/lib/build/claude-completion')
    await expect(mod.completeText({ system: 'sys', user: 'user' })).rejects.toThrow('NO_CLAUDE_PROVIDER')
  })

  it('calls client.messages.create with the right shape and returns joined text', async () => {
    process.env.CODY_USE_BEDROCK = '1'
    process.env.AWS_BEARER_TOKEN_BEDROCK = 'tok'
    vi.resetModules()

    // Patch fetch so BedrockMessages.create() resolves cleanly.
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: ' World' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fakeFetch)

    const mod = await import('@/lib/build/claude-completion')
    const result = await mod.completeText({ system: 'You are helpful.', user: 'Say hello', maxTokens: 512, temperature: 0.5 })
    expect(result.text).toBe('Hello\n World')
    expect(result.provider).toBe('bedrock')
    expect(result.usage?.input_tokens).toBe(10)
    expect(result.usage?.output_tokens).toBe(5)
  })

  it('passes defaults maxTokens=2048 and temperature=0.6 when omitted', async () => {
    process.env.CODY_USE_BEDROCK = '1'
    process.env.AWS_BEARER_TOKEN_BEDROCK = 'tok'
    vi.resetModules()

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'result' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fakeFetch)

    const mod = await import('@/lib/build/claude-completion')
    await mod.completeText({ system: 'sys', user: 'usr' })
    const body = JSON.parse(fakeFetch.mock.calls[0][1].body)
    expect(body.max_tokens).toBe(2048)
    expect(body.temperature).toBe(0.6)
  })

  it('filters out non-text content blocks', async () => {
    process.env.CODY_USE_BEDROCK = '1'
    process.env.AWS_BEARER_TOKEN_BEDROCK = 'tok'
    vi.resetModules()

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          { type: 'tool_use', id: 'tu1' },
          { type: 'text', text: 'Only me' },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fakeFetch)

    const mod = await import('@/lib/build/claude-completion')
    const result = await mod.completeText({ system: 'sys', user: 'usr' })
    expect(result.text).toBe('Only me')
  })

  it('propagates Bedrock HTTP errors as thrown exceptions', async () => {
    process.env.CODY_USE_BEDROCK = '1'
    process.env.AWS_BEARER_TOKEN_BEDROCK = 'tok'
    vi.resetModules()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    } as unknown as Response))

    const mod = await import('@/lib/build/claude-completion')
    await expect(mod.completeText({ system: 'sys', user: 'usr' })).rejects.toThrow(/Bedrock invoke failed/)
  })
})

// ── BedrockClient.messages.create — shape validation ────────────────────────

describe('BedrockClient — request shaping', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('sends correct anthropic_version in Bedrock request body', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fakeFetch)

    const { BedrockClient } = await import('@/lib/bedrock-client')
    const client = new BedrockClient({
      CODY_USE_BEDROCK: '1',
      AWS_BEARER_TOKEN_BEDROCK: 'tok',
      AWS_REGION: 'us-west-2',
    } as NodeJS.ProcessEnv)
    await client.messages.create({ max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] })
    const body = JSON.parse(fakeFetch.mock.calls[0][1].body)
    expect(body.anthropic_version).toBe('bedrock-2023-05-31')
    expect(body.max_tokens).toBe(100)
  })

  it('includes system prompt when provided', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fakeFetch)

    const { BedrockClient } = await import('@/lib/bedrock-client')
    const client = new BedrockClient({
      CODY_USE_BEDROCK: '1',
      AWS_BEARER_TOKEN_BEDROCK: 'tok',
    } as NodeJS.ProcessEnv)
    await client.messages.create({ max_tokens: 100, system: 'be helpful', messages: [{ role: 'user', content: 'test' }] })
    const body = JSON.parse(fakeFetch.mock.calls[0][1].body)
    expect(body.system).toBe('be helpful')
  })

  it('uses the region from env in the endpoint URL', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fakeFetch)

    const { BedrockClient } = await import('@/lib/bedrock-client')
    const client = new BedrockClient({
      CODY_USE_BEDROCK: '1',
      AWS_BEARER_TOKEN_BEDROCK: 'tok',
      AWS_REGION: 'eu-central-1',
    } as NodeJS.ProcessEnv)
    await client.messages.create({ max_tokens: 10, messages: [{ role: 'user', content: 'x' }] })
    const url: string = fakeFetch.mock.calls[0][0]
    expect(url).toContain('eu-central-1')
  })
})
