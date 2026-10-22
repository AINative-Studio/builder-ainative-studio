import { describe, it, expect, vi, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Issue #1266: runDesignSubagent/runCodeSubagent/runValidationSubagent called
// a bare Anthropic client's messages.create() with no AbortSignal/timeout --
// the same unbounded-call bug class as #1253. Reached via runOrchestratorAgent
// from app/api/chat-ws/route.ts whenever USE_SUBAGENTS=true.
vi.hoisted(() => {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = 'sk-test-mock-key-for-unit-tests'
  }
})

const h = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn(() => ({ messages: { create: h.create } }))
  return { default: MockAnthropic }
})

vi.mock('@/lib/agent/zeromemory', () => ({
  recallPastPerformance: vi.fn(async () => ''),
  storeGenerationMemory: vi.fn(async () => {}),
}))

beforeAll(() => {
  h.create.mockResolvedValue({
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
  })
})

describe('subagents.ts calls are time-boxed (#1266)', () => {
  it('runDesignSubagent passes an AbortSignal to messages.create', async () => {
    h.create.mockClear()
    const { runDesignSubagent } = await import('@/lib/agent/subagents')
    await runDesignSubagent('build a login form', '')
    expect(h.create).toHaveBeenCalledTimes(1)
    const [, options] = h.create.mock.calls[0]
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })

  it('runCodeSubagent passes an AbortSignal to messages.create', async () => {
    h.create.mockClear()
    const { runCodeSubagent } = await import('@/lib/agent/subagents')
    await runCodeSubagent('design spec', 'system prompt', 'build a login form')
    expect(h.create).toHaveBeenCalledTimes(1)
    const [, options] = h.create.mock.calls[0]
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })

  it('runValidationSubagent passes an AbortSignal to messages.create', async () => {
    h.create.mockClear()
    const { runValidationSubagent } = await import('@/lib/agent/subagents')
    await runValidationSubagent('export default function X() {}', 'design spec')
    expect(h.create).toHaveBeenCalledTimes(1)
    const [, options] = h.create.mock.calls[0]
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })

  it('source: every messages.create call site carries a timeout signal', () => {
    const src = readFileSync(join(__dirname, '../../lib/agent/subagents.ts'), 'utf-8')
    const createCallCount = [...src.matchAll(/anthropic\.messages\.create\(/g)].length
    const timeoutCount = [...src.matchAll(/AbortSignal\.timeout\(SUBAGENT_CALL_TIMEOUT_MS\)/g)].length
    expect(createCallCount).toBe(3)
    expect(timeoutCount).toBe(3)
  })
})
