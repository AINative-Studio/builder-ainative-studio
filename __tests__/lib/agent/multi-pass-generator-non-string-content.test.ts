import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Real bug, found live (2026-11-04): a real multi-phase e-commerce product
// generation failed Phase 1 with "e.replace is not a function" — confirmed
// via Railway logs for two concurrent founder generations (chatIds
// pZgmo9uAd5qFEcAETz5lm, -EG1gdduPIzanhvD9Ub7q), surfacing right after
// "[Phase 1/6] Extracting and validating code for phase 1...".
//
// Root cause: generateChunk() does
//   const rawResponse = response.choices?.[0]?.message?.content || ''
// — the `|| ''` only guards null/undefined/empty-string content, not a
// TRUTHY non-string value (e.g. some OpenAI-compatible providers return
// `content` as an array of content blocks rather than a plain string for
// certain models/response shapes). That non-string rawResponse is then
// passed straight into validateGeneratedCode() -> extractCodeFromMarkdown(),
// which calls String.prototype.replace()/.match() on it directly — and an
// array has no .replace, throwing exactly the observed TypeError.

vi.mock('@/lib/agent/zeromemory', () => ({
  recallPastPerformance: vi.fn(async () => null),
  storeGenerationMemory: vi.fn(async () => undefined),
}))

// Use the REAL validator here (not mocked) — the whole point is proving
// validateGeneratedCode() is handed a real string, not an array/object.
import { executeChunkPlanWithBudget, CHUNK_MAX_TOKENS } from '@/lib/agent/multi-pass-generator'
import { createGenerationBudget } from '@/lib/build/generation-budget'

const MODEL = 'claude-sonnet-4-5-20250929'

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

describe('multi-pass-generator handles a non-string API response content (live incident)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('extracts the real text and succeeds when the provider returns content as an array of text blocks instead of a plain string', async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () => ({
            // Real-world shape some OpenAI-compatible providers use for
            // multi-modal/content-blocks responses, instead of a plain string.
            choices: [{ message: { content: [{ type: 'text', text: '```jsx\nexport default function App(){return <div/>}\n```' }] } }],
            usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 },
          })),
        },
      },
    } as any

    const result = await executeChunkPlanWithBudget(
      planWithPhases(1), client, MODEL, vi.fn(), 'chat-nonstring-1',
      { budget: createGenerationBudget({ limitUsd: 5.0, model: MODEL }) },
    )

    // The real bug, confirmed via a direct repro against the real
    // validateGeneratedCode(): without a fix this throws
    // "content.match is not a function" (an array has no .match), caught by
    // generateChunk's try/catch and surfaced as that exact error string —
    // the phase fails even though real, usable text WAS in the response.
    expect(result.chunks[0].success).toBe(true)
    expect(result.chunks[0].error).toBeUndefined()
    expect(result.chunks[0].code).toContain('export default function App')
  })

  it('does not crash with an internal TypeError when content is an empty array (whatever validateGeneratedCode normally does with empty input, unchanged)', async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () => ({
            choices: [{ message: { content: [] } }],
            usage: { prompt_tokens: 1000, completion_tokens: 0, total_tokens: 1000 },
          })),
        },
      },
    } as any

    const result = await executeChunkPlanWithBudget(
      planWithPhases(1), client, MODEL, vi.fn(), 'chat-nonstring-2',
      { budget: createGenerationBudget({ limitUsd: 5.0, model: MODEL }) },
    )

    // The real bug: without the fix, this throws "content.match is not a
    // function" instead of going through validateGeneratedCode's normal
    // (pre-existing, unchanged-by-this-fix) handling of empty content.
    if (result.chunks[0].error) {
      expect(result.chunks[0].error).not.toMatch(/is not a function/)
    }
  })

  it('handles the normal, already-working plain-string content case unchanged', async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () => ({
            choices: [{ message: { content: '```jsx\nexport default function App(){return <div/>}\n```' } }],
            usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 },
          })),
        },
      },
    } as any

    const result = await executeChunkPlanWithBudget(
      planWithPhases(1), client, MODEL, vi.fn(), 'chat-nonstring-3',
      { budget: createGenerationBudget({ limitUsd: 5.0, model: MODEL }) },
    )

    expect(result.chunks[0].success).toBe(true)
    expect(result.chunks[0].code).toContain('export default function App')
  })
})
