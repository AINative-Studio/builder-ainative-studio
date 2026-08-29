/**
 * POST /api/build/artifact — resilience behavior added while fixing the Dwellow
 * landing-page bug (silent fallback to placeholder copy with no durable error
 * trail — see components/build/artifacts/company-artifacts.tsx / gen-helpers.tsx).
 *
 * Properties under test (model calls are MOCKED — no network):
 *   - a parseable response on the FIRST pass returns immediately, no repair call,
 *   - unparseable JSON triggers ONE repair pass on the SAME provider before
 *     falling through to the next provider,
 *   - a hard call failure (throw) does NOT trigger a same-provider repair pass —
 *     it falls through to the next provider immediately,
 *   - exhausting every provider/pass reports to Sentry with the full attempt
 *     trail and still returns the existing 503 generation_unavailable contract,
 *   - a genuine success anywhere never calls Sentry.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  getClaudeCompletion: vi.fn(),
  messagesCreate: vi.fn(),
  ainativeCreate: vi.fn(),
  captureMessage: vi.fn(),
  auth: vi.fn(),
}))

vi.mock('@/lib/build/claude-completion', () => ({
  getClaudeCompletion: h.getClaudeCompletion,
}))

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: h.ainativeCreate } }
  },
}))

vi.mock('@sentry/nextjs', () => ({
  captureMessage: h.captureMessage,
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))

import { POST } from '@/app/api/build/artifact/route'

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

const VALID_BODY = { view: 'landing', idea: 'A knowledge search tool for support teams' }

function anthropicText(text: string) {
  return { content: [{ type: 'text', text }] }
}

function ainativeText(text: string) {
  return { choices: [{ message: { content: text } }] }
}

const GOOD_JSON = JSON.stringify({
  eyebrow: 'YOUR COMPANY', headline: 'Ask anything.', sub: 'Cited answers.', features: [],
})

beforeEach(() => {
  h.getClaudeCompletion.mockReset()
  h.messagesCreate.mockReset()
  h.ainativeCreate.mockReset()
  h.captureMessage.mockReset()
  h.auth.mockReset().mockResolvedValue(null) // anonymous → hobbyist tier
})

describe('POST /api/build/artifact — resilience', () => {
  it('returns immediately on a parseable first-pass response, no repair call', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValueOnce(anthropicText(GOOD_JSON))

    const res = await POST(req(VALID_BODY))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.content.headline).toBe('Ask anything.')
    expect(h.messagesCreate).toHaveBeenCalledTimes(1)
    expect(h.captureMessage).not.toHaveBeenCalled()
  })

  it('retries the SAME provider once with a repair instruction on unparseable JSON, then succeeds', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate
      // No '{' at all — parseJson can't extract a balanced object, genuinely unparseable.
      .mockResolvedValueOnce(anthropicText('Sure! Here is your landing page copy, hope that helps!'))
      .mockResolvedValueOnce(anthropicText(GOOD_JSON))

    const res = await POST(req(VALID_BODY))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.content.headline).toBe('Ask anything.')
    expect(h.messagesCreate).toHaveBeenCalledTimes(2)
    // second call is the repair pass — its prompt carries the repair instruction
    const secondCallArgs = h.messagesCreate.mock.calls[1][0]
    expect(secondCallArgs.messages[0].content).toMatch(/could not be parsed as JSON/i)
    expect(h.captureMessage).not.toHaveBeenCalled()
  })

  it('does NOT run a repair pass after a hard call failure — falls through to AINative immediately', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockRejectedValueOnce(new Error('ECONNRESET'))
    h.ainativeCreate.mockResolvedValueOnce(ainativeText(GOOD_JSON))

    const res = await POST(req(VALID_BODY))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.provider).toBe('ainative')
    // exactly one claude call (no same-provider repair retry after a throw)
    expect(h.messagesCreate).toHaveBeenCalledTimes(1)
  })

  it('falls through Claude → AINative tier model → AINative fallback model, each with a repair pass, before giving up', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate
      .mockResolvedValueOnce(anthropicText('not json'))
      .mockResolvedValueOnce(anthropicText('still not json'))
    h.ainativeCreate
      .mockResolvedValueOnce(ainativeText('nope'))
      .mockResolvedValueOnce(ainativeText('nope again'))
      .mockResolvedValueOnce(ainativeText('nope a third time'))
      .mockResolvedValueOnce(ainativeText('nope a fourth time'))

    const res = await POST(req(VALID_BODY))
    const data = await res.json()

    expect(res.status).toBe(503)
    expect(data.error).toBe('generation_unavailable')
    expect(data.view).toBe('landing')
    // Claude: 2 passes (original + repair). AINative: 2 models × 2 passes = 4.
    expect(h.messagesCreate).toHaveBeenCalledTimes(2)
    expect(h.ainativeCreate).toHaveBeenCalledTimes(4)
  })

  it('reports full exhaustion to Sentry with the complete per-attempt trail, tagged by view/track/tier', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockRejectedValue(new Error('bedrock timeout'))
    h.ainativeCreate.mockRejectedValue(new Error('ainative down'))

    const res = await POST(req(VALID_BODY))
    expect(res.status).toBe(503)

    expect(h.captureMessage).toHaveBeenCalledTimes(1)
    const [message, opts] = h.captureMessage.mock.calls[0]
    expect(message).toMatch(/landing/)
    expect(opts.level).toBe('error')
    expect(opts.tags.view).toBe('landing')
    expect(opts.tags.track).toBe('app')
    expect(Array.isArray(opts.extra.attempts)).toBe(true)
    expect(opts.extra.attempts.length).toBeGreaterThan(0)
    expect(opts.extra.attempts.join(' ')).toMatch(/bedrock timeout|ainative down/)
  })

  it('rejects a missing/unknown view with 400 before touching any provider', async () => {
    const res = await POST(req({ view: 'not-a-real-view', idea: 'x' }))
    expect(res.status).toBe(400)
    expect(h.getClaudeCompletion).not.toHaveBeenCalled()
  })

  it('rejects a missing/too-short idea with 400', async () => {
    const res = await POST(req({ view: 'landing', idea: 'ab' }))
    expect(res.status).toBe(400)
  })
})
