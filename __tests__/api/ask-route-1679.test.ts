/**
 * #1679 — POST /ask: NLWeb-convention discovery alias for the real, already-
 * grounded /api/build/help logic. No new knowledge base — this just forwards
 * to the same route handler so the two never diverge.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  getClaudeCompletion: vi.fn(),
  messagesCreate: vi.fn(),
  ainativeCreate: vi.fn(),
}))

vi.mock('@/lib/build/claude-completion', () => ({
  getClaudeCompletion: h.getClaudeCompletion,
}))

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: h.ainativeCreate } }
  },
}))

import { POST } from '@/app/api/ask/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

function claudeOk() {
  return {
    client: { messages: { create: h.messagesCreate } },
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-5-20250929',
  }
}

beforeEach(() => {
  h.getClaudeCompletion.mockReset()
  h.messagesCreate.mockReset()
  h.ainativeCreate.mockReset()
})

describe('POST /ask (#1679)', () => {
  it('answers a real question about Builder, grounded with cited sources', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'You deploy by starting a subscription.' }],
    })

    const res = await POST(req({ question: 'how do I deploy my app to a live url?' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.answer).toContain('deploy')
    expect(Array.isArray(body.sources)).toBe(true)
    expect(body.sources.length).toBeGreaterThan(0)
  })

  it('accepts the NLWeb-convention `query` field as an alias for `question`', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Yes, you own everything.' }],
    })

    const res = await POST(req({ query: 'do I own the code and is there lock-in?' }))
    expect(res.status).toBe(200)
    expect(h.messagesCreate).toHaveBeenCalledTimes(1)
    const arg = h.messagesCreate.mock.calls[0][0]
    expect(arg.messages[0].content).toMatch(/own the code/i)
  })

  it('400 when neither question nor query is provided', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(400)
    expect(h.messagesCreate).not.toHaveBeenCalled()
  })

  it('never 500s: falls back to the curated FAQ answer when no model is reachable', async () => {
    h.getClaudeCompletion.mockReturnValue(null)
    h.ainativeCreate.mockRejectedValue(new Error('ainative down'))

    const res = await POST(req({ question: 'how much does it cost?' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.provider).toBe('faq')
    expect(body.answer.length).toBeGreaterThan(0)
  })
})
