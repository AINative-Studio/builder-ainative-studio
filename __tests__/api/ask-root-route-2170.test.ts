/**
 * #2170 — GET/POST /ask at the root path: NLWeb-convention conversational
 * endpoint (nlweb.ai spec). Builds on #1679's grounding logic (same mocking
 * boundary as __tests__/api/ask-route-1679.test.ts) but asserts the NLWeb
 * response shape (`_meta`/`results`/`answer`) this route is responsible for,
 * plus GET query-param support and SSE streaming.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

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

import { GET, POST } from '@/app/ask/route'

function claudeOk() {
  return {
    client: { messages: { create: h.messagesCreate } },
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-5-20250929',
  }
}

function getReq(url: string): NextRequest {
  return new NextRequest(new Request(url))
}

function postReq(url: string, body: unknown): NextRequest {
  return new NextRequest(new Request(url, { method: 'POST', body: JSON.stringify(body) }))
}

async function readSse(res: Response): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value)
  }
  return text
}

beforeEach(() => {
  h.getClaudeCompletion.mockReset()
  h.messagesCreate.mockReset()
  h.ainativeCreate.mockReset()
})

describe('GET /ask (#2170)', () => {
  it('400 when no query/question param is present', async () => {
    const res = await GET(getReq('https://builder.ainative.studio/ask'))
    expect(res.status).toBe(400)
  })

  it('returns an NLWeb-shaped response (_meta/results/answer) for a non-streaming request', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'You deploy by starting a subscription.' }],
    })

    const res = await GET(getReq('https://builder.ainative.studio/ask?query=how+do+I+deploy'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json()
    expect(body.answer).toContain('deploy')
    expect(body._meta).toMatchObject({ query: 'how do I deploy', timestamp: expect.any(String) })
    expect(Array.isArray(body.results)).toBe(true)
    expect(body.results.length).toBeGreaterThan(0)
    expect(body.results[0]).toMatchObject({ '@type': 'Question', url: expect.any(String), name: expect.any(String) })
  })

  it('accepts `question` as an alias for `query`', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Yes, you own everything.' }] })

    const res = await GET(getReq('https://builder.ainative.studio/ask?question=do+I+own+the+code'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body._meta.query).toBe('do I own the code')
  })

  it('streams SSE (meta/result/answer/done events) when Accept: text/event-stream is sent', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Pricing starts free.' }] })

    const req = new NextRequest(
      new Request('https://builder.ainative.studio/ask?query=how+much+does+it+cost', {
        headers: { Accept: 'text/event-stream' },
      }),
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')

    const text = await readSse(res)
    expect(text).toContain('event: meta')
    expect(text).toContain('event: result')
    expect(text).toContain('event: answer')
    expect(text).toContain('event: done')
    expect(text).toContain('Pricing starts free.')
  })

  it('never hangs the SSE stream on an upstream failure — emits an error event and closes', async () => {
    h.getClaudeCompletion.mockImplementation(() => {
      throw new Error('boom')
    })
    h.ainativeCreate.mockRejectedValue(new Error('also down'))

    const req = new NextRequest(
      new Request('https://builder.ainative.studio/ask?query=anything', {
        headers: { Accept: 'text/event-stream' },
      }),
    )
    const res = await GET(req)
    const text = await readSse(res)
    // Even with no model reachable, the real route falls back to a curated
    // FAQ answer (never throws) — confirm the stream still completes cleanly
    // either via a real answer or an explicit error event, never hanging.
    expect(text).toMatch(/event: (answer|error)/)
    expect(text).toContain('event: done')
  })
})

describe('POST /ask (#2170)', () => {
  it('400 when neither query nor question is provided', async () => {
    const res = await POST(postReq('https://builder.ainative.studio/ask', {}))
    expect(res.status).toBe(400)
  })

  it('returns the same NLWeb shape as GET, via a JSON body', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'You deploy by starting a subscription.' }] })

    const res = await POST(postReq('https://builder.ainative.studio/ask', { query: 'how do I deploy my app' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.answer).toContain('deploy')
    expect(body._meta.query).toBe('how do I deploy my app')
    expect(Array.isArray(body.results)).toBe(true)
  })

  it('accepts `question` as an alias for `query`', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Yes, you own everything.' }] })

    const res = await POST(postReq('https://builder.ainative.studio/ask', { question: 'do I own the code' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body._meta.query).toBe('do I own the code')
  })

  it('never 500s: falls back to the curated FAQ answer when no model is reachable', async () => {
    h.getClaudeCompletion.mockReturnValue(null)
    h.ainativeCreate.mockRejectedValue(new Error('ainative down'))

    const res = await POST(postReq('https://builder.ainative.studio/ask', { question: 'how much does it cost?' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.answer.length).toBeGreaterThan(0)
  })
})
