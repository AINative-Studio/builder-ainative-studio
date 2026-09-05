/**
 * POST /api/build/surprise-idea — LLM-generated "Surprise me" starter idea.
 *
 * Real gap this fixes: the static SURPRISE_IDEAS pool (lib/build/surprise-ideas.ts)
 * is a fixed 14-string array, so Agent402/Model Catalog/Developer Program/
 * Community/AINativeNGO can NEVER be selected no matter how many times a
 * founder clicks "Surprise me" — none of the 14 fixed sentences contain their
 * trigger words. This route replaces the static pick with a real LLM call
 * grounded in the live primitive catalog, biased toward underrepresented
 * primitives, with the static pool kept only as the failure fallback.
 *
 * Properties under test (the LLM client is MOCKED — no network; model output
 * is inherently non-deterministic so we don't assert on generated CONTENT,
 * only on the deterministic request/response/fallback shape):
 *   - a real completion is sanitized and returned with source: 'llm',
 *   - an unusable completion (empty/garbage/too long) falls back to the static pool,
 *   - a thrown/rejected model call falls back to the static pool (never 500s),
 *   - the request grounds the prompt in the real, full primitive catalog,
 *   - selected primitives from a successful generation are recorded so the
 *     NEXT call's steer favors what this one didn't cover.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  create: vi.fn(),
}))

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: h.create } }
  },
}))

import { POST, __resetSurpriseIdeaHistoryForTests } from '@/app/api/build/surprise-idea/route'
import { SURPRISE_IDEAS } from '@/lib/build/surprise-ideas'

function completionOf(content: string) {
  return { choices: [{ message: { content } }] }
}

beforeEach(() => {
  h.create.mockReset()
  __resetSurpriseIdeaHistoryForTests()
})

describe('POST /api/build/surprise-idea', () => {
  it('returns a real LLM-generated idea, sanitized, with source "llm"', async () => {
    h.create.mockResolvedValue(completionOf('"A support copilot that resolves tickets from a knowledge base."'))
    const res = await POST({} as any)
    const json = await res.json()
    expect(json.source).toBe('llm')
    // Quotes stripped by sanitizeSurpriseIdea — never returned to the client raw.
    expect(json.idea).toBe('A support copilot that resolves tickets from a knowledge base.')
  })

  it('grounds the request in the real, full primitive catalog (not a hardcoded subset)', async () => {
    h.create.mockResolvedValue(completionOf('An idea that composes real primitives together nicely.'))
    await POST({} as any)
    const args = h.create.mock.calls[0][0]
    const userMessage = args.messages.find((m: any) => m.role === 'user').content as string
    expect(userMessage).toContain('Agent402')
    expect(userMessage).toContain('AINativeNGO')
    expect(userMessage).toContain('Model Catalog')
  })

  it('uses the cheap, fast AINative-proxied model chosen by real comparison (llama-4-maverick-17b-128e), not Claude/Bedrock or kimi', async () => {
    h.create.mockResolvedValue(completionOf('An idea that composes real primitives together nicely.'))
    await POST({} as any)
    const args = h.create.mock.calls[0][0]
    expect(args.model).toBe('llama-4-maverick-17b-128e')
  })

  it('respects a SURPRISE_IDEA_MODEL override', async () => {
    const prev = process.env.SURPRISE_IDEA_MODEL
    process.env.SURPRISE_IDEA_MODEL = 'some-other-model'
    try {
      h.create.mockResolvedValue(completionOf('An idea that composes real primitives together nicely.'))
      await POST({} as any)
      const args = h.create.mock.calls[0][0]
      expect(args.model).toBe('some-other-model')
    } finally {
      if (prev === undefined) delete process.env.SURPRISE_IDEA_MODEL
      else process.env.SURPRISE_IDEA_MODEL = prev
    }
  })

  it('falls back to the static pool when the model call throws', async () => {
    h.create.mockRejectedValue(new Error('provider unavailable'))
    const res = await POST({} as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.source).toBe('fallback')
    expect(SURPRISE_IDEAS).toContain(json.idea)
  })

  it('falls back to the static pool when the completion is empty', async () => {
    h.create.mockResolvedValue(completionOf(''))
    const res = await POST({} as any)
    const json = await res.json()
    expect(json.source).toBe('fallback')
    expect(SURPRISE_IDEAS).toContain(json.idea)
  })

  it('falls back to the static pool when the completion is unusably short', async () => {
    h.create.mockResolvedValue(completionOf('nope'))
    const res = await POST({} as any)
    const json = await res.json()
    expect(json.source).toBe('fallback')
    expect(SURPRISE_IDEAS).toContain(json.idea)
  })

  it('never throws / never returns a non-200 even when the provider is completely broken', async () => {
    h.create.mockImplementation(() => {
      throw new Error('synchronous blowup')
    })
    const res = await POST({} as any)
    expect(res.status).toBe(200)
  })

  it('records the selected primitives from a successful generation so the next steer favors what it missed', async () => {
    // A cap-table idea selects OpenCapStack (real trigger match) — the NEXT
    // call's prompt should then steer away from it, toward something else.
    h.create.mockResolvedValueOnce(
      completionOf('A cap-table and investor-update tool that turns SAFEs into a real equity story.'),
    )
    await POST({} as any)

    h.create.mockResolvedValueOnce(completionOf('An idea that composes real primitives together nicely.'))
    await POST({} as any)
    const secondCallArgs = h.create.mock.calls[1][0]
    const secondUserMessage = secondCallArgs.messages.find((m: any) => m.role === 'user').content as string
    // OpenCapStack was just surfaced — the steer list should favor other names
    // instead of immediately re-suggesting the one just covered.
    expect(secondUserMessage).not.toMatch(/UNDERREPRESENTED[^\n]*OpenCapStack/)
  })
})
