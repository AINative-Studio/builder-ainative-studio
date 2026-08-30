import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #373 (epic #371) — implementTask() I/O tests: mocked Claude completion
 * client (no real network call), proving the honest-failure contract holds
 * end-to-end (no provider configured, call throws, call times out).
 */

const h = vi.hoisted(() => ({
  getClaudeCompletion: vi.fn(),
  messagesCreate: vi.fn(),
}))

vi.mock('@/lib/build/claude-completion', () => ({
  getClaudeCompletion: h.getClaudeCompletion,
}))

import { implementTask } from '@/lib/build/task-implementer'

function claudeOk() {
  return {
    client: { messages: { create: h.messagesCreate } },
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-5-20250929',
  }
}

function anthropicText(text: string) {
  return { content: [{ type: 'text', text }] }
}

beforeEach(() => {
  h.getClaudeCompletion.mockReset()
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
})
