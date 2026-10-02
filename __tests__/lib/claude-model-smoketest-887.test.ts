import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * Issue #887: no smoke-test verifying Builder's configured CLAUDE_MODEL
 * stays live. Real past incident (app/api/chat-ws/route.ts ~line 99-102): a
 * hardcoded Claude model ID 404'd and silently fell through to a cheaper
 * fallback while still logged as Claude. These tests verify the smoke test
 * actually detects both failure modes: a hard API error, and a silent
 * model-mismatch where the API responds 200 but with a different model than
 * requested.
 */

const anthropicCreateMock = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: anthropicCreateMock }
      constructor(_opts: any) {}
    },
  }
})

import { runClaudeModelSmokeTest, resolveClaudeModel } from '@/lib/config/claude-model-smoketest'

function cleanEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env = { NODE_ENV: 'test' } as unknown as Record<string, string | undefined>
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) env[k] = v
  }
  return env as NodeJS.ProcessEnv
}

describe('resolveClaudeModel', () => {
  it('defaults to the known-working Sonnet 4.5 ID when CLAUDE_MODEL is unset', () => {
    expect(resolveClaudeModel(cleanEnv({}))).toBe('claude-sonnet-4-5-20250929')
  })

  it('is env-overridable', () => {
    expect(resolveClaudeModel(cleanEnv({ CLAUDE_MODEL: 'claude-opus-4-6' }))).toBe('claude-opus-4-6')
  })
})

describe('runClaudeModelSmokeTest', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    anthropicCreateMock.mockReset()
  })

  it('reports ok:false with provider:none when no Claude path is configured at all', async () => {
    const env = cleanEnv({})
    const result = await runClaudeModelSmokeTest(env)
    expect(result.ok).toBe(false)
    expect(result.provider).toBe('none')
    expect(result.error).toMatch(/Bedrock|Anthropic/)
  })

  it('Bedrock path: succeeds on a healthy 200 response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'ok' }],
        model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        usage: { input_tokens: 5, output_tokens: 1 },
      }),
    }) as any

    const env = cleanEnv({
      CODY_USE_BEDROCK: '1',
      AWS_BEARER_TOKEN_BEDROCK: 'test-bearer-token',
    })

    const result = await runClaudeModelSmokeTest(env)
    expect(result.ok).toBe(true)
    expect(result.provider).toBe('bedrock')
    expect(result.respondedModel).toBe('us.anthropic.claude-sonnet-4-5-20250929-v1:0')
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [, init] = (global.fetch as any).mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.max_tokens).toBe(1)
  })

  it('Bedrock path: detects a hard failure (stale/404 model ID) and reports it, not a silent pass', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'model not found',
    }) as any

    const env = cleanEnv({
      CODY_USE_BEDROCK: '1',
      AWS_BEARER_TOKEN_BEDROCK: 'test-bearer-token',
      BEDROCK_MODEL_ID: 'us.anthropic.claude-stale-id-v1:0',
    })

    const result = await runClaudeModelSmokeTest(env)
    expect(result.ok).toBe(false)
    expect(result.provider).toBe('bedrock')
    expect(result.error).toMatch(/404/)
  })

  it('Bedrock path: reports a specific failure when CODY_USE_BEDROCK=1 but the bearer token is missing (not a silent fallthrough to none)', async () => {
    const env = cleanEnv({ CODY_USE_BEDROCK: '1' })
    const result = await runClaudeModelSmokeTest(env)
    expect(result.ok).toBe(false)
    expect(result.provider).toBe('bedrock')
    expect(result.error).toMatch(/bearer token/i)
  })

  it('direct Anthropic path: succeeds when the API echoes back the requested model', async () => {
    anthropicCreateMock.mockResolvedValueOnce({
      model: 'claude-sonnet-4-5-20250929',
      content: [{ type: 'text', text: 'ok' }],
    })

    const env = cleanEnv({ ANTHROPIC_API_KEY: 'sk-ant-test-key' })
    const result = await runClaudeModelSmokeTest(env)

    expect(result.ok).toBe(true)
    expect(result.provider).toBe('anthropic')
    expect(result.respondedModel).toBe('claude-sonnet-4-5-20250929')
  })

  it('direct Anthropic path: detects the EXACT original incident — a stale model ID silently served by a different model', async () => {
    anthropicCreateMock.mockResolvedValueOnce({
      // Simulates the real incident: requested a Claude ID, API responded
      // (200, no error) but with a completely different model.
      model: 'gpt-oss-20b',
      content: [{ type: 'text', text: 'ok' }],
    })

    const env = cleanEnv({
      ANTHROPIC_API_KEY: 'sk-ant-test-key',
      CLAUDE_MODEL: 'claude-sonnet-4-20250514', // the stale ID from the incident
    })
    const result = await runClaudeModelSmokeTest(env)

    expect(result.ok).toBe(false)
    expect(result.provider).toBe('anthropic')
    expect(result.requestedModel).toBe('claude-sonnet-4-20250514')
    expect(result.respondedModel).toBe('gpt-oss-20b')
    expect(result.error).toMatch(/mismatch/i)
  })

  it('direct Anthropic path: reports a hard API error rather than throwing', async () => {
    anthropicCreateMock.mockRejectedValueOnce(new Error('404 model_not_found'))

    const env = cleanEnv({ ANTHROPIC_API_KEY: 'sk-ant-test-key' })
    const result = await runClaudeModelSmokeTest(env)

    expect(result.ok).toBe(false)
    expect(result.provider).toBe('anthropic')
    expect(result.error).toMatch(/404/)
  })

  it('prefers Bedrock over direct Anthropic when both are configured (matches getPrimaryClaudeClient precedence)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'ok' }],
        model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      }),
    }) as any

    const env = cleanEnv({
      CODY_USE_BEDROCK: '1',
      AWS_BEARER_TOKEN_BEDROCK: 'test-bearer-token',
      ANTHROPIC_API_KEY: 'sk-ant-also-configured',
    })

    const result = await runClaudeModelSmokeTest(env)
    expect(result.provider).toBe('bedrock')
    expect(anthropicCreateMock).not.toHaveBeenCalled()
  })
})
