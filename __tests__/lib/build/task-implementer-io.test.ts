import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #373 (epic #371) — implementTask() I/O tests: mocked Claude completion
 * client (no real network call), proving the honest-failure contract holds
 * end-to-end (no provider configured, call throws, call times out).
 */

const h = vi.hoisted(() => ({
  getClaudeCompletion: vi.fn(),
  getFallbackCompletion: vi.fn(),
  messagesCreate: vi.fn(),
}))

vi.mock('@/lib/build/claude-completion', async () => {
  // isBedrockRateLimited is pure (plain string matching, no env/network
  // access) so the real implementation is used — getClaudeCompletion and
  // getFallbackCompletion both resolve real provider clients from env vars,
  // so they stay mocked for deterministic, network-free tests.
  const actual = await vi.importActual<typeof import('@/lib/build/claude-completion')>(
    '@/lib/build/claude-completion',
  )
  return {
    isBedrockRateLimited: actual.isBedrockRateLimited,
    getClaudeCompletion: h.getClaudeCompletion,
    getFallbackCompletion: h.getFallbackCompletion,
  }
})

import { implementTask } from '@/lib/build/task-implementer'

function claudeOk() {
  return {
    client: { messages: { create: h.messagesCreate } },
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-5-20250929',
  }
}

function claudeBedrock() {
  return {
    client: { messages: { create: h.messagesCreate } },
    provider: 'bedrock' as const,
    model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  }
}

function anthropicText(text: string) {
  return { content: [{ type: 'text', text }] }
}

beforeEach(() => {
  h.getClaudeCompletion.mockReset()
  h.getFallbackCompletion.mockReset()
  h.getFallbackCompletion.mockReturnValue(null)
  h.messagesCreate.mockReset()
})

describe('implementTask', () => {
  it('returns ok:false honestly when no completion provider is configured', async () => {
    h.getClaudeCompletion.mockReturnValue(null)
    const result = await implementTask({ title: 'x' }, {})
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/no completion provider/i)
    expect(h.messagesCreate).not.toHaveBeenCalled()
  })

  it('returns real changed files on a clean success', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValueOnce(
      anthropicText(JSON.stringify({ ok: true, files: { 'app/page.tsx': 'new content' } })),
    )
    const result = await implementTask({ title: 'Add a button' }, { 'app/page.tsx': 'old content' })
    expect(result.ok).toBe(true)
    expect(result.files).toEqual({ 'app/page.tsx': 'new content' })
  })

  it('passes the story + existing files into the actual model call', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValueOnce(
      anthropicText(JSON.stringify({ ok: true, files: { 'a.ts': 'x' } })),
    )
    await implementTask({ title: 'Add dark mode', detail: 'Use localStorage' }, { 'a.ts': 'existing' })
    const callArgs = h.messagesCreate.mock.calls[0][0]
    expect(callArgs.messages[0].content).toContain('Add dark mode')
    expect(callArgs.messages[0].content).toContain('Use localStorage')
    expect(callArgs.messages[0].content).toContain('existing')
  })

  it('returns ok:false honestly when the model reports the story cannot be implemented', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValueOnce(
      anthropicText(JSON.stringify({ ok: false, reason: 'Requires a backend endpoint that does not exist.' })),
    )
    const result = await implementTask({ title: 'Impossible story' }, {})
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('Requires a backend endpoint that does not exist.')
  })

  it('returns ok:false honestly when the completion call throws — never fabricates success', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockRejectedValueOnce(new Error('ECONNRESET'))
    const result = await implementTask({ title: 'x' }, {})
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/implementation call failed/i)
    expect(result.reason).toMatch(/ECONNRESET/)
  })

  it('returns ok:false honestly when the model returns unparseable output', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValueOnce(anthropicText('not json at all'))
    const result = await implementTask({ title: 'x' }, {})
    expect(result.ok).toBe(false)
  })

  it('does NOT retry on failure — a single attempt only (v1 scope decision)', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockRejectedValueOnce(new Error('transient blip'))
    await implementTask({ title: 'x' }, {})
    expect(h.messagesCreate).toHaveBeenCalledTimes(1)
  })

  describe('Bedrock daily-token-quota 429 fallback (found live 2026-11-16, groundwork/wallkind)', () => {
    it('does NOT fall back on a non-rate-limit failure, even on Bedrock', async () => {
      h.getClaudeCompletion.mockReturnValue(claudeBedrock())
      const fallbackCreate = vi.fn()
      h.getFallbackCompletion.mockReturnValue({
        client: { messages: { create: fallbackCreate } },
        provider: 'anthropic',
        model: 'claude-sonnet-4-5-20250929',
      })
      h.messagesCreate.mockRejectedValueOnce(new Error('ECONNRESET'))
      const result = await implementTask({ title: 'x' }, {})
      expect(result.ok).toBe(false)
      expect(fallbackCreate).not.toHaveBeenCalled()
    })

    it('does NOT fall back on a Bedrock 429 when no fallback provider is configured', async () => {
      h.getClaudeCompletion.mockReturnValue(claudeBedrock())
      h.getFallbackCompletion.mockReturnValue(null)
      h.messagesCreate.mockRejectedValueOnce(
        new Error('Bedrock invoke failed: HTTP 429 {"message":"Too many tokens per day, please wait before trying again."}'),
      )
      const result = await implementTask({ title: 'x' }, {})
      expect(result.ok).toBe(false)
      expect(result.reason).toMatch(/too many tokens per day/i)
      expect(h.messagesCreate).toHaveBeenCalledTimes(1)
    })

    it('falls over to the fallback provider on a Bedrock 429, and succeeds', async () => {
      h.getClaudeCompletion.mockReturnValue(claudeBedrock())
      const fallbackCreate = vi.fn().mockResolvedValueOnce(
        anthropicText(JSON.stringify({ ok: true, files: { 'a.ts': 'fixed via fallback' } })),
      )
      h.getFallbackCompletion.mockReturnValue({
        client: { messages: { create: fallbackCreate } },
        provider: 'anthropic',
        model: 'claude-sonnet-4-5-20250929',
      })
      h.messagesCreate.mockRejectedValueOnce(
        new Error('Bedrock invoke failed: HTTP 429 {"message":"Too many tokens per day, please wait before trying again."}'),
      )
      const result = await implementTask({ title: 'x' }, {})
      expect(result.ok).toBe(true)
      expect(result.files).toEqual({ 'a.ts': 'fixed via fallback' })
      expect(h.messagesCreate).toHaveBeenCalledTimes(1)
      expect(fallbackCreate).toHaveBeenCalledTimes(1)
    })

    it('returns an honest combined failure when the fallback provider ALSO fails', async () => {
      h.getClaudeCompletion.mockReturnValue(claudeBedrock())
      const fallbackCreate = vi.fn().mockRejectedValueOnce(new Error('fallback down too'))
      h.getFallbackCompletion.mockReturnValue({
        client: { messages: { create: fallbackCreate } },
        provider: 'anthropic',
        model: 'claude-sonnet-4-5-20250929',
      })
      h.messagesCreate.mockRejectedValueOnce(
        new Error('Bedrock invoke failed: HTTP 429 {"message":"Too many tokens per day, please wait before trying again."}'),
      )
      const result = await implementTask({ title: 'x' }, {})
      expect(result.ok).toBe(false)
      expect(result.reason).toMatch(/too many tokens per day/i)
      expect(result.reason).toMatch(/fallback also failed/i)
      expect(result.reason).toMatch(/fallback down too/i)
    })
  })
})
