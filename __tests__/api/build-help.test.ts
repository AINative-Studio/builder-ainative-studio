/**
 * #60 — POST /api/build/help: the AI "ask anything" backend for the Help Center.
 *
 * Properties under test (model calls are MOCKED — no network):
 *   - empty question → 400,
 *   - a real question → grounded Claude answer + FAQ `sources` citations,
 *   - the system prompt fed to the model is GROUNDED in retrieved FAQ context,
 *   - Claude failure falls back to the AINative-hosted model,
 *   - both models failing falls back to the top curated FAQ answer (never 500),
 *   - buildHelpSystemPrompt embeds the grounding context.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  getClaudeCompletion: vi.fn(),
  messagesCreate: vi.fn(),
  ainativeCreate: vi.fn(),
}))

// Mock the shared Claude resolver.
vi.mock('@/lib/build/claude-completion', () => ({
  getClaudeCompletion: h.getClaudeCompletion,
}))

// Mock the OpenAI client used for the AINative fallback path.
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: h.ainativeCreate } }
  },
}))

import { POST, buildHelpSystemPrompt } from '@/app/api/build/help/route'

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

describe('buildHelpSystemPrompt', () => {
  it('embeds the grounding context and forbids invention', () => {
    const prompt = buildHelpSystemPrompt('[FAQ 1] Q: X\nA: Y')
    expect(prompt).toContain('[FAQ 1] Q: X')
    expect(prompt).toMatch(/do NOT invent/i)
    expect(prompt).toMatch(/AINative Builder/)
  })
})

describe('POST /api/build/help (#60)', () => {
  it('400 when the question is empty', async () => {
    const res = await POST(req({ question: '   ' }))
    expect(res.status).toBe(400)
    expect(h.messagesCreate).not.toHaveBeenCalled()
  })

  it('400 when the body is malformed', async () => {
    const res = await POST(req(null))
    expect(res.status).toBe(400)
  })

  it('returns a grounded Claude answer + FAQ sources', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'You deploy by starting a subscription.' }],
    })

    const res = await POST(req({ question: 'how do I deploy my app to a live url?' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.answer).toContain('deploy')
    expect(body.provider).toBe('anthropic')
    expect(Array.isArray(body.sources)).toBe(true)
    expect(body.sources.length).toBeGreaterThan(0)
    // The deploy FAQ must be among the grounding sources.
    expect(body.sources.map((s: any) => s.id)).toContain('how-do-i-deploy')
  })

  it('feeds the model a GROUNDED system prompt (RAG)', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Yes, you own everything.' }],
    })

    await POST(req({ question: 'do I own the code and is there lock-in?' }))
    expect(h.messagesCreate).toHaveBeenCalledTimes(1)
    const arg = h.messagesCreate.mock.calls[0][0]
    expect(arg.system).toContain('GROUNDED KNOWLEDGE')
    // The ownership answer text must be present in the grounding.
    expect(arg.system).toMatch(/own 100%|you own/i)
    // The user's question is passed as the message.
    expect(arg.messages[0].content).toMatch(/own the code/i)
  })

  it('falls back to the AINative model when Claude fails', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockRejectedValue(new Error('bedrock 503'))
    h.ainativeCreate.mockResolvedValue({
      choices: [{ message: { content: 'Fallback grounded answer.' } }],
    })

    const res = await POST(req({ question: 'which ai models power cody?' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.provider).toBe('ainative')
    expect(body.answer).toBe('Fallback grounded answer.')
    expect(h.ainativeCreate).toHaveBeenCalledTimes(1)
  })

  it('falls back to the curated FAQ answer when NO model is reachable (never 500)', async () => {
    h.getClaudeCompletion.mockReturnValue(null) // no Claude provider
    h.ainativeCreate.mockRejectedValue(new Error('ainative down'))

    const res = await POST(req({ question: 'how much does it cost?' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.provider).toBe('faq')
    expect(body.answer.length).toBeGreaterThan(0)
    // Grounded in the cost FAQ.
    expect(body.sources.map((s: any) => s.id)).toContain('what-does-it-cost')
  })

  it('skips the Claude call entirely when no provider is configured', async () => {
    h.getClaudeCompletion.mockReturnValue(null)
    h.ainativeCreate.mockResolvedValue({
      choices: [{ message: { content: 'AINative answer.' } }],
    })

    const res = await POST(req({ question: 'what is ainative builder?' }))
    expect(res.status).toBe(200)
    expect(h.messagesCreate).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.provider).toBe('ainative')
  })
})
