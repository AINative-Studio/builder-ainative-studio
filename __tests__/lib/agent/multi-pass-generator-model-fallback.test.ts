import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Real incident, found live (2026-11-04): a real "Lumenware"/"Terraclay"
// e-commerce product generation hit a Bedrock daily-token-quota 429 on EVERY
// phase of multi-pass chunking. executeChunkPlanWithBudget's existing retry
// (one retry per failed phase) re-calls generateChunk() with the IDENTICAL
// (client, modelId) pair — so a 429 on attempt 1 guarantees the exact same
// 429 on the retry. All 6-7 phases failed identically in ~10s each, 0 tokens
// generated, "build failed" — confirmed via Railway logs (issue #1802/#1804).
//
// Fix: when a phase fails with a rate-limit-shaped error (HTTP 429, or a 5xx
// from the same provider), retry with a DIFFERENT model from a caller-supplied
// fallback list — the same proven STANDARD_FALLBACKS rotation pattern already
// used by app/api/chat-ws/route.ts's runValidationRetryLoop (models:
// ['qwen-coder-32b', 'gpt-oss-20b', 'ministral-14b']), rather than hammering
// the identical rate-limited model/provider twice.

vi.mock('@/lib/agent/zeromemory', () => ({
  recallPastPerformance: vi.fn(async () => null),
  storeGenerationMemory: vi.fn(async () => undefined),
}))

vi.mock('@/lib/code-validator', () => ({
  validateGeneratedCode: vi.fn((raw: string) => ({ valid: true, code: raw, error: undefined })),
}))

import {
  executeChunkPlanWithBudget,
  CHUNK_MAX_TOKENS,
} from '@/lib/agent/multi-pass-generator'
import { createGenerationBudget } from '@/lib/build/generation-budget'

const PRIMARY_MODEL = 'claude-sonnet-4-5-20250929'
const FALLBACK_MODELS = ['qwen-coder-32b', 'gpt-oss-20b', 'ministral-14b']

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

/** A 429-shaped error, matching the OpenAI SDK's real APIError shape (`.status`). */
function rateLimitError() {
  const err: any = new Error('429 status code (no body)')
  err.status = 429
  return err
}

/**
 * A fake client that records which MODEL each call was made with, and can be
 * configured to fail (with a 429) for specific models.
 */
function fakeClientRejectingModels(rejectedModels: Set<string>) {
  const callsByModel: string[] = []
  const client = {
    chat: {
      completions: {
        create: vi.fn(async ({ model }: { model: string }) => {
          callsByModel.push(model)
          if (rejectedModels.has(model)) {
            throw rateLimitError()
          }
          return {
            choices: [{ message: { content: '```jsx\nexport default function App(){return <div/>}\n```' } }],
            usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 },
          }
        }),
      },
    },
  }
  return { client: client as any, callsByModel }
}

describe('multi-pass-generator model fallback on rate-limit (#1802/#1804)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('retries a 429-failed phase with a DIFFERENT model from fallbackModels, not the same one', async () => {
    // PRIMARY_MODEL always 429s; every fallback model succeeds.
    const { client, callsByModel } = fakeClientRejectingModels(new Set([PRIMARY_MODEL]))

    const result = await executeChunkPlanWithBudget(
      planWithPhases(1),
      client,
      PRIMARY_MODEL,
      vi.fn(),
      'chat-fallback-1',
      {
        budget: createGenerationBudget({ limitUsd: 5.0, model: PRIMARY_MODEL }),
        fallbackModels: FALLBACK_MODELS,
      },
    )

    // Real bug: without the fix, callsByModel is [PRIMARY_MODEL, PRIMARY_MODEL]
    // (the retry uses the SAME model) and the phase never recovers.
    expect(callsByModel[0]).toBe(PRIMARY_MODEL)
    expect(callsByModel[1]).not.toBe(PRIMARY_MODEL)
    expect(FALLBACK_MODELS).toContain(callsByModel[1])
    expect(result.chunks[0].success).toBe(true)
  })

  it('recovers the phase when the fallback model succeeds where the primary 429d', async () => {
    const { client } = fakeClientRejectingModels(new Set([PRIMARY_MODEL]))
    const onProgress = vi.fn()

    const result = await executeChunkPlanWithBudget(
      planWithPhases(1), client, PRIMARY_MODEL, onProgress, 'chat-fallback-2',
      { budget: createGenerationBudget({ limitUsd: 5.0, model: PRIMARY_MODEL }), fallbackModels: FALLBACK_MODELS },
    )

    expect(result.chunks[0].success).toBe(true)
    expect(result.chunks[0].validationPassed).toBe(true)
    const messages = onProgress.mock.calls.map((c) => c[2] as string)
    expect(messages.some((m) => m === 'All phases completed')).toBe(true)
  })

  it('still fails the phase honestly when EVERY model (primary + all fallbacks) 429s', async () => {
    const { client, callsByModel } = fakeClientRejectingModels(
      new Set([PRIMARY_MODEL, ...FALLBACK_MODELS]),
    )

    const result = await executeChunkPlanWithBudget(
      planWithPhases(1), client, PRIMARY_MODEL, vi.fn(), 'chat-fallback-3',
      { budget: createGenerationBudget({ limitUsd: 5.0, model: PRIMARY_MODEL }), fallbackModels: FALLBACK_MODELS },
    )

    expect(result.chunks[0].success).toBe(false)
    // Only ONE retry still happens (no change to the retry COUNT, only which
    // model the retry uses) — this must not silently start looping forever.
    expect(callsByModel.length).toBe(2)
  })

  it('does not change behavior when no fallbackModels are supplied (backward compatible)', async () => {
    const { client, callsByModel } = fakeClientRejectingModels(new Set([PRIMARY_MODEL]))

    const result = await executeChunkPlanWithBudget(
      planWithPhases(1), client, PRIMARY_MODEL, vi.fn(), 'chat-fallback-4',
      { budget: createGenerationBudget({ limitUsd: 5.0, model: PRIMARY_MODEL }) },
    )

    // No fallbackModels given — retry still uses the SAME model (prior,
    // existing behavior), so both calls 429 and the phase fails.
    expect(callsByModel).toEqual([PRIMARY_MODEL, PRIMARY_MODEL])
    expect(result.chunks[0].success).toBe(false)
  })

  it('does NOT use a fallback model when the failure is a content/validation error, not rate-limiting', async () => {
    // A non-429 error (e.g. a genuine validation failure surfaced as a thrown
    // Error with no .status) should keep retrying the ORIGINAL model — swapping
    // models for a content-quality problem wouldn't help and changes behavior
    // no bug report asked for.
    let calls = 0
    const callsByModel: string[] = []
    const client = {
      chat: {
        completions: {
          create: vi.fn(async ({ model }: { model: string }) => {
            calls += 1
            callsByModel.push(model)
            if (calls === 1) throw new Error('some non-rate-limit failure')
            return {
              choices: [{ message: { content: '```jsx\nexport default function App(){return <div/>}\n```' } }],
              usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 },
            }
          }),
        },
      },
    } as any

    await executeChunkPlanWithBudget(
      planWithPhases(1), client, PRIMARY_MODEL, vi.fn(), 'chat-fallback-5',
      { budget: createGenerationBudget({ limitUsd: 5.0, model: PRIMARY_MODEL }), fallbackModels: FALLBACK_MODELS },
    )

    expect(callsByModel).toEqual([PRIMARY_MODEL, PRIMARY_MODEL])
  })
})
