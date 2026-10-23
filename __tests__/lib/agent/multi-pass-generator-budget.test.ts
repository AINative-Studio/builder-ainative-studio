import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ZeroMemory is fire-and-forget I/O in the real module — stub it so these tests
// exercise the budget loop, not the network.
vi.mock('@/lib/agent/zeromemory', () => ({
  recallPastPerformance: vi.fn(async () => null),
  storeGenerationMemory: vi.fn(async () => undefined),
}))

// Validation passes through: we care about call COUNT and cost, not codegen quality.
vi.mock('@/lib/code-validator', () => ({
  validateGeneratedCode: vi.fn((raw: string) => ({ valid: true, code: raw, error: undefined })),
}))

import {
  executeChunkPlanWithBudget,
  executeChunkPlan,
  CHUNK_MAX_TOKENS,
} from '@/lib/agent/multi-pass-generator'
import { createGenerationBudget } from '@/lib/build/generation-budget'

const MODEL = 'claude-sonnet-4-5-20250929'

/** A chunk plan with N phases, shaped like chunk-planner's real output. */
function planWithPhases(n: number) {
  return {
    phases: Array.from({ length: n }, (_, i) => ({
      chunkId: `chunk-${i + 1}`,
      phaseNumber: (i === 0 ? 1 : i === n - 1 ? 3 : 2) as 1 | 2 | 3,
      phaseType: (i === 0 ? 'core' : i === n - 1 ? 'integration' : 'feature') as 'core' | 'feature' | 'integration',
      description: `phase ${i + 1}`,
      prompt: `Build part ${i + 1}`,
      targetTokens: CHUNK_MAX_TOKENS,
      dependencies: [],
    })),
  } as any
}

/**
 * A fake OpenAI-shaped client that reports FULL 16k output usage on every call
 * — the real worst case for a rich build — and counts how many times it was
 * actually billed.
 */
function fakeClient(opts: { failFirstN?: number } = {}) {
  let calls = 0
  const client = {
    chat: {
      completions: {
        create: vi.fn(async () => {
          calls += 1
          const shouldFail = opts.failFirstN !== undefined && calls <= opts.failFirstN
          return {
            choices: [{ message: { content: shouldFail ? '' : '```jsx\nexport default function App(){return <div/>}\n```' } }],
            usage: {
              prompt_tokens: 4000,
              completion_tokens: CHUNK_MAX_TOKENS,
              total_tokens: 4000 + CHUNK_MAX_TOKENS,
            },
          }
        }),
      },
    },
  }
  return { client: client as any, callCount: () => calls }
}

describe('multi-pass-generator cost cap (#1192 — the real runaway loop)', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.restoreAllMocks()
  })

  it('stops a 10-phase plan partway instead of billing all 10 real LLM calls', async () => {
    // One phase worst case: 4000*3/1e6 + 16000*15/1e6 = $0.012 + $0.24 = $0.252.
    // A $0.60 cap affords 2 phases; the 3rd would project to $0.756 > $0.60.
    const { client, callCount } = fakeClient()
    const onProgress = vi.fn()

    const result = await executeChunkPlanWithBudget(
      planWithPhases(10),
      client,
      MODEL,
      onProgress,
      'chat-runaway',
      { budget: createGenerationBudget({ limitUsd: 0.60, model: MODEL }) },
    )

    expect(callCount()).toBeGreaterThan(0)   // real work happened
    expect(callCount()).toBeLessThan(10)     // but not all 10 phases were billed
    expect(result.budget.stopped).toBe(true)
    expect(result.budgetStop).toBeDefined()
    expect(result.budgetStop!.type).toBe('budget_exceeded')
    // The cap actually held.
    expect(result.budget.spentUsd).toBeLessThanOrEqual(0.60)
  })

  it('returns the PARTIAL chunks it did generate, not an empty array', async () => {
    const { client } = fakeClient()
    const result = await executeChunkPlanWithBudget(
      planWithPhases(10), client, MODEL, vi.fn(), 'chat-partial',
      { budget: createGenerationBudget({ limitUsd: 0.60, model: MODEL }) },
    )
    expect(result.chunks.length).toBeGreaterThan(0)
    expect(result.chunks.length).toBeLessThan(10)
    expect(result.budgetStop!.partial).toBe(true)
  })

  it('reports the stop through onProgress with the real spend and limit', async () => {
    const onProgress = vi.fn()
    const { client } = fakeClient()
    await executeChunkPlanWithBudget(
      planWithPhases(10), client, MODEL, onProgress, 'chat-progress',
      { budget: createGenerationBudget({ limitUsd: 0.60, model: MODEL }) },
    )

    const stopCall = onProgress.mock.calls.find((c) => c[3]?.budgetExceeded === true)
    expect(stopCall).toBeDefined()
    expect(stopCall![2]).toMatch(/cost limit/i)
    expect(stopCall![3].limitUsd).toBe(0.60)
    expect(stopCall![3].spentUsd).toBeGreaterThan(0)
  })

  it('does NOT claim "All phases completed" when it was stopped by the cap', async () => {
    const onProgress = vi.fn()
    const { client } = fakeClient()
    await executeChunkPlanWithBudget(
      planWithPhases(10), client, MODEL, onProgress, 'chat-honest',
      { budget: createGenerationBudget({ limitUsd: 0.60, model: MODEL }) },
    )
    const messages = onProgress.mock.calls.map((c) => c[2] as string)
    expect(messages.some((m) => m === 'All phases completed')).toBe(false)
    expect(messages.some((m) => /Stopped after \d+ of 10 phases/.test(m))).toBe(true)
  })

  it('counts a phase RETRY against the cap — a failing phase can no longer double its spend unchecked', async () => {
    // Every call "fails" validation-wise by returning empty content, so each
    // phase tries twice. With a cap that affords ~2 calls total, the loop must
    // not get through 2 phases × 2 calls = 4 calls.
    const { client, callCount } = fakeClient({ failFirstN: 100 })
    const result = await executeChunkPlanWithBudget(
      planWithPhases(5), client, MODEL, vi.fn(), 'chat-retry',
      { budget: createGenerationBudget({ limitUsd: 0.60, model: MODEL }) },
    )
    expect(callCount()).toBeLessThanOrEqual(3)
    expect(result.budget.spentUsd).toBeLessThanOrEqual(0.60)
  })

  it('runs a plan that fits entirely, with no stop and an honest completion', async () => {
    const onProgress = vi.fn()
    const { client, callCount } = fakeClient()
    const result = await executeChunkPlanWithBudget(
      planWithPhases(3), client, MODEL, onProgress, 'chat-fits',
      { budget: createGenerationBudget({ limitUsd: 5.0, model: MODEL }) },
    )
    expect(callCount()).toBe(3)
    expect(result.budgetStop).toBeUndefined()
    expect(result.budget.stopped).toBe(false)
    expect(result.budget.calls).toBe(3)
    expect(onProgress.mock.calls.map((c) => c[2])).toContain('All phases completed')
  })

  it('accumulates the REAL reported usage, not the worst-case estimate', async () => {
    const { client } = fakeClient()
    const result = await executeChunkPlanWithBudget(
      planWithPhases(3), client, MODEL, vi.fn(), 'chat-usage',
      { budget: createGenerationBudget({ limitUsd: 5.0, model: MODEL }) },
    )
    expect(result.budget.totalInputTokens).toBe(3 * 4000)
    expect(result.budget.totalOutputTokens).toBe(3 * CHUNK_MAX_TOKENS)
    // 3 × $0.252
    expect(result.budget.spentUsd).toBeCloseTo(3 * 0.252, 6)
  })

  it('applies the configured env cap when no budget is passed in', async () => {
    process.env.GENERATION_BUDGET_USD = '0.60'
    const { client, callCount } = fakeClient()
    const result = await executeChunkPlanWithBudget(
      planWithPhases(10), client, MODEL, vi.fn(), 'chat-env',
    )
    expect(callCount()).toBeLessThan(10)
    expect(result.budget.limitUsd).toBe(0.60)
    expect(result.budget.stopped).toBe(true)
  })

  it('keeps executeChunkPlan backward compatible — still resolves to a chunk array', async () => {
    const { client } = fakeClient()
    const chunks = await executeChunkPlan(
      planWithPhases(2), client, MODEL, vi.fn(), 'chat-compat',
      { budget: createGenerationBudget({ limitUsd: 5.0, model: MODEL }) },
    )
    expect(Array.isArray(chunks)).toBe(true)
    expect(chunks).toHaveLength(2)
  })
})
