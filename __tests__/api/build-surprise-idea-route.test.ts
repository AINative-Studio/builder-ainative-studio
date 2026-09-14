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

/** Build a fake NextRequest-like object whose .json() resolves to `body` —
 *  matches the minimal surface the route actually calls (request.json()). */
function reqWithBody(body: unknown) {
  return { json: async () => body } as any
}

beforeEach(() => {
  h.create.mockReset()
  __resetSurpriseIdeaHistoryForTests()
})

describe('POST /api/build/surprise-idea', () => {
  it('returns a real LLM-generated idea, sanitized, with source "llm"', async () => {
    h.create.mockResolvedValue(completionOf('"A support copilot that resolves tickets from a knowledge base."'))
    const res = await POST(reqWithBody({}))
    const json = await res.json()
    expect(json.source).toBe('llm')
    // Quotes stripped by sanitizeSurpriseIdea — never returned to the client raw.
    expect(json.idea).toBe('A support copilot that resolves tickets from a knowledge base.')
  })

  it('grounds the request in the real, full primitive catalog (not a hardcoded subset)', async () => {
    h.create.mockResolvedValue(completionOf('An idea that composes real primitives together nicely.'))
    await POST(reqWithBody({}))
    const args = h.create.mock.calls[0][0]
    const userMessage = args.messages.find((m: any) => m.role === 'user').content as string
    expect(userMessage).toContain('Agent402')
    expect(userMessage).toContain('AINativeNGO')
    expect(userMessage).toContain('Model Catalog')
  })

  it('uses the cheap, fast AINative-proxied model chosen by real comparison (llama-4-maverick-17b-128e), not Claude/Bedrock or kimi', async () => {
    h.create.mockResolvedValue(completionOf('An idea that composes real primitives together nicely.'))
    await POST(reqWithBody({}))
    const args = h.create.mock.calls[0][0]
    expect(args.model).toBe('llama-4-maverick-17b-128e')
  })

  it('respects a SURPRISE_IDEA_MODEL override', async () => {
    const prev = process.env.SURPRISE_IDEA_MODEL
    process.env.SURPRISE_IDEA_MODEL = 'some-other-model'
    try {
      h.create.mockResolvedValue(completionOf('An idea that composes real primitives together nicely.'))
      await POST(reqWithBody({}))
      const args = h.create.mock.calls[0][0]
      expect(args.model).toBe('some-other-model')
    } finally {
      if (prev === undefined) delete process.env.SURPRISE_IDEA_MODEL
      else process.env.SURPRISE_IDEA_MODEL = prev
    }
  })

  it('falls back to the static pool when the model call throws', async () => {
    h.create.mockRejectedValue(new Error('provider unavailable'))
    const res = await POST(reqWithBody({}))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.source).toBe('fallback')
    expect(SURPRISE_IDEAS).toContain(json.idea)
  })

  it('falls back to the static pool when the completion is empty', async () => {
    h.create.mockResolvedValue(completionOf(''))
    const res = await POST(reqWithBody({}))
    const json = await res.json()
    expect(json.source).toBe('fallback')
    expect(SURPRISE_IDEAS).toContain(json.idea)
  })

  it('falls back to the static pool when the completion is unusably short', async () => {
    h.create.mockResolvedValue(completionOf('nope'))
    const res = await POST(reqWithBody({}))
    const json = await res.json()
    expect(json.source).toBe('fallback')
    expect(SURPRISE_IDEAS).toContain(json.idea)
  })

  it('never throws / never returns a non-200 even when the provider is completely broken', async () => {
    h.create.mockImplementation(() => {
      throw new Error('synchronous blowup')
    })
    const res = await POST(reqWithBody({}))
    expect(res.status).toBe(200)
  })

  it('records the selected primitives from a successful generation so the next steer favors what it missed', async () => {
    // A cap-table idea selects OpenCapStack (real trigger match) — the NEXT
    // call's prompt should then steer away from it, toward something else.
    h.create.mockResolvedValueOnce(
      completionOf('A cap-table and investor-update tool that turns SAFEs into a real equity story.'),
    )
    await POST(reqWithBody({}))

    h.create.mockResolvedValueOnce(completionOf('An idea that composes real primitives together nicely.'))
    await POST(reqWithBody({}))
    const secondCallArgs = h.create.mock.calls[1][0]
    const secondUserMessage = secondCallArgs.messages.find((m: any) => m.role === 'user').content as string
    // OpenCapStack was just surfaced — the steer list should favor other names
    // instead of immediately re-suggesting the one just covered.
    expect(secondUserMessage).not.toMatch(/UNDERREPRESENTED[^\n]*OpenCapStack/)
  })

  // #755 — the non-negotiable PER-USER case: the same founder clicking
  // "Surprise me" multiple times in one sitting must see genuinely varied
  // ideas. Verified here by asserting the real prior idea text this session
  // showed actually reaches the constructed prompt on each subsequent call.
  describe('per-session idea-history steer (#755)', () => {
    it('passes the client-supplied recentIdeas into the prompt as explicit negative examples', async () => {
      h.create.mockResolvedValue(completionOf('An idea that composes real primitives together nicely.'))
      const priorIdea = 'A field service management platform that automates scheduling and invoicing for tradespeople.'
      await POST(reqWithBody({ recentIdeas: [priorIdea] }))
      const args = h.create.mock.calls[0][0]
      const userMessage = args.messages.find((m: any) => m.role === 'user').content as string
      expect(userMessage).toContain(priorIdea)
      expect(userMessage).toMatch(/avoid repeating or closely resembling/i)
    })

    it('carries a REAL, growing session history across 3+ sequential calls (simulating repeated clicks in one sitting)', async () => {
      // Call 1: no history yet.
      h.create.mockResolvedValueOnce(
        completionOf('A field service management platform that automates scheduling and invoicing for tradespeople.'),
      )
      const res1 = await POST(reqWithBody({ recentIdeas: [] }))
      const idea1 = (await res1.json()).idea as string
      const firstCallArgs = h.create.mock.calls[0][0]
      const firstUserMessage = firstCallArgs.messages.find((m: any) => m.role === 'user').content as string
      expect(firstUserMessage).not.toMatch(/avoid repeating/i)

      // Call 2: the client now sends idea1 back — a REAL client builds this
      // array up exactly like BuildStart.tsx's recentIdeasRef does.
      h.create.mockResolvedValueOnce(
        completionOf('A field service management platform that automates work order forms and technician dispatch.'),
      )
      const res2 = await POST(reqWithBody({ recentIdeas: [idea1] }))
      const idea2 = (await res2.json()).idea as string
      const secondCallArgs = h.create.mock.calls[1][0]
      const secondUserMessage = secondCallArgs.messages.find((m: any) => m.role === 'user').content as string
      expect(secondUserMessage).toContain(idea1)

      // Call 3: both prior ideas must now be present — real, meaningfully
      // different content requested to be avoided on each successive call.
      h.create.mockResolvedValueOnce(completionOf('A completely different kind of idea about logistics.'))
      await POST(reqWithBody({ recentIdeas: [idea1, idea2] }))
      const thirdCallArgs = h.create.mock.calls[2][0]
      const thirdUserMessage = thirdCallArgs.messages.find((m: any) => m.role === 'user').content as string
      expect(thirdUserMessage).toContain(idea1)
      expect(thirdUserMessage).toContain(idea2)
      expect(idea1).not.toBe(idea2)
    })

    it('ignores a missing recentIdeas field without throwing (first-ever click, cold session)', async () => {
      h.create.mockResolvedValue(completionOf('An idea that composes real primitives together nicely.'))
      const res = await POST(reqWithBody({}))
      expect(res.status).toBe(200)
    })

    it('ignores a malformed recentIdeas field (not an array) without throwing', async () => {
      h.create.mockResolvedValue(completionOf('An idea that composes real primitives together nicely.'))
      const res = await POST(reqWithBody({ recentIdeas: 'not-an-array' }))
      expect(res.status).toBe(200)
      const args = h.create.mock.calls[0][0]
      const userMessage = args.messages.find((m: any) => m.role === 'user').content as string
      expect(userMessage).not.toMatch(/avoid repeating/i)
    })

    it('never throws when request.json() itself rejects (malformed body)', async () => {
      h.create.mockResolvedValue(completionOf('An idea that composes real primitives together nicely.'))
      const badReq = { json: async () => { throw new Error('bad body') } } as any
      const res = await POST(badReq)
      expect(res.status).toBe(200)
    })

    it('filters out non-string and blank entries from a client-supplied recentIdeas array', async () => {
      h.create.mockResolvedValue(completionOf('An idea that composes real primitives together nicely.'))
      const realIdea = 'A real idea about a real business that does real things for real customers.'
      await POST(reqWithBody({ recentIdeas: [123, null, '', '   ', realIdea] }))
      const args = h.create.mock.calls[0][0]
      const userMessage = args.messages.find((m: any) => m.role === 'user').content as string
      expect(userMessage).toContain(realIdea)
    })
  })
})
