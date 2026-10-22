import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const h = vi.hoisted(() => ({ create: vi.fn(), getClaudeCompletion: vi.fn() }))
vi.mock('@/lib/build/claude-completion', () => ({ getClaudeCompletion: h.getClaudeCompletion }))

// Issue #1266: explainBeforeBuilding() and summarizeArtifactStep() called
// completion.client.messages.create() raw, with no AbortSignal/timeout --
// the same unbounded-call bug class as #1253. A stalled upstream response
// hung /api/build/cody-explain or /api/build/cody-summary forever.
describe('cody-chat.ts calls are time-boxed (#1266)', () => {
  beforeEach(() => {
    h.create.mockReset()
    h.getClaudeCompletion.mockReset().mockReturnValue({
      client: { messages: { create: h.create } }, provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', label: 'Anthropic',
    })
  })

  it('explainBeforeBuilding passes an AbortSignal to messages.create', async () => {
    h.create.mockResolvedValue({ content: [{ type: 'text', text: 'Building your preview.' }] })
    const { explainBeforeBuilding } = await import('@/lib/build/cody-chat')
    await explainBeforeBuilding('preview', 'company', 'an idea')
    expect(h.create).toHaveBeenCalledTimes(1)
    const [, options] = h.create.mock.calls[0]
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })

  it('summarizeArtifactStep passes an AbortSignal to messages.create', async () => {
    h.create.mockResolvedValue({ content: [{ type: 'text', text: 'This is your thesis.' }] })
    const { summarizeArtifactStep } = await import('@/lib/build/cody-chat')
    await summarizeArtifactStep('thesis', 'company', { headline: 'x' })
    expect(h.create).toHaveBeenCalledTimes(1)
    const [, options] = h.create.mock.calls[0]
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })

  it('a stalled/aborted call is caught and returns ok:false, never hangs', async () => {
    h.create.mockImplementation((_params: unknown, options: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')))
    }))
    const { explainBeforeBuilding } = await import('@/lib/build/cody-chat')
    const pending = explainBeforeBuilding('preview', 'company', 'an idea')
    // Simulate the real AbortSignal.timeout firing without waiting out the real timer.
    const [, options] = h.create.mock.calls[0]
    options.signal.dispatchEvent(new Event('abort'))
    const result = await pending
    expect(result.ok).toBe(false)
  })

  it('source: both messages.create call sites carry a timeout signal', () => {
    const src = readFileSync(join(__dirname, '../../../lib/build/cody-chat.ts'), 'utf-8')
    const createCallCount = [...src.matchAll(/completion\.client\.messages\.create\(/g)].length
    const timeoutCount = [...src.matchAll(/AbortSignal\.timeout\(CODY_CHAT_CALL_TIMEOUT_MS\)/g)].length
    expect(createCallCount).toBe(2)
    expect(timeoutCount).toBe(2)
  })
})
