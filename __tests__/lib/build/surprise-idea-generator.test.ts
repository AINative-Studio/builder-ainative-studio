import { describe, it, expect } from 'vitest'
import {
  underrepresentedPrimitives,
  buildSurpriseIdeaPrompt,
  sanitizeSurpriseIdea,
  isUsableSurpriseIdea,
  SURPRISE_IDEA_SYSTEM_PROMPT,
  RECENT_HISTORY_WINDOW,
  RECENT_IDEA_TEXT_WINDOW,
} from '@/lib/build/surprise-idea-generator'
import { CATALOG } from '@/lib/build/primitive-catalog'

/**
 * LLM-generated "Surprise me" — the deterministic half (prompt construction +
 * recency tracking). The actual model output is non-deterministic and is not
 * asserted on here; the network call itself is covered by the route test,
 * which mocks the LLM client and tests real request/response/fallback shape.
 */

const catalog = [
  { name: 'Alpha' },
  { name: 'Beta' },
  { name: 'Gamma' },
]

describe('underrepresentedPrimitives', () => {
  it('returns every catalog name when there is no history yet', () => {
    expect(underrepresentedPrimitives(catalog, [])).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('excludes names that appeared in recent history', () => {
    const history = [['Alpha'], ['Beta']]
    expect(underrepresentedPrimitives(catalog, history)).toEqual(['Gamma'])
  })

  it('only looks at the most recent RECENT_HISTORY_WINDOW entries', () => {
    // Alpha only appears outside the window, so it counts as underrepresented
    // again once its mention scrolls out of the window.
    const old = Array.from({ length: RECENT_HISTORY_WINDOW }, () => ['Beta'])
    const history = [['Alpha'], ...old]
    expect(underrepresentedPrimitives(catalog, history)).toContain('Alpha')
    expect(underrepresentedPrimitives(catalog, history)).not.toContain('Beta')
  })

  it('falls back to the full catalog when every primitive has recently appeared (nothing left to steer toward)', () => {
    const history = [['Alpha', 'Beta', 'Gamma']]
    expect(underrepresentedPrimitives(catalog, history)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('is real against the actual live catalog (not a toy fixture) — every real primitive counts as underrepresented on a cold start', () => {
    const names = underrepresentedPrimitives(CATALOG, [])
    expect(names.length).toBe(CATALOG.length)
    expect(names).toContain('Agent402')
    expect(names).toContain('AINativeNGO')
  })
})

describe('buildSurpriseIdeaPrompt', () => {
  it('grounds the prompt in the full real catalog (name + purpose), not a hardcoded subset', () => {
    const { user } = buildSurpriseIdeaPrompt(CATALOG, [])
    for (const p of CATALOG) {
      expect(user).toContain(p.name)
    }
    // Purpose text is included too, not just names — the model needs to know
    // WHAT each primitive does to compose a plausible idea around it.
    expect(user).toContain(CATALOG.find((p) => p.name === 'ZeroCommerce')!.purpose)
  })

  it('steers toward underrepresented primitives when history is provided', () => {
    // Build a fake recent history that includes everything except Agent402
    // and AINativeNGO, so those two should show up in the steer sample.
    const allButTwo = CATALOG.map((p) => p.name).filter((n) => n !== 'Agent402' && n !== 'AINativeNGO')
    const { steerTowards } = buildSurpriseIdeaPrompt(CATALOG, [allButTwo])
    expect(steerTowards).toContain('Agent402')
    expect(steerTowards).toContain('AINativeNGO')
  })

  it('caps the steer sample instead of dumping the whole underrepresented list into the prompt', () => {
    const { steerTowards } = buildSurpriseIdeaPrompt(CATALOG, [])
    expect(steerTowards.length).toBeLessThanOrEqual(6)
  })

  it('the system prompt matches the existing SURPRISE_IDEAS tone/shape instruction', () => {
    expect(SURPRISE_IDEA_SYSTEM_PROMPT).toMatch(/single sentence/i)
    expect(SURPRISE_IDEA_SYSTEM_PROMPT).toMatch(/An X that Ys/)
  })

  it('never instructs the model to name internal primitives inside the idea sentence itself', () => {
    const { system } = buildSurpriseIdeaPrompt(CATALOG, [])
    expect(system).toMatch(/never mention the platform/i)
  })

  // #755: the real per-user repetition fix — concept-similarity steer using
  // actual prior idea TEXT from this founder's own session, not just the
  // process-scoped primitive-category proxy.
  it('omits the avoid-repeating clause entirely when there is no prior idea text (cold session)', () => {
    const { user } = buildSurpriseIdeaPrompt(CATALOG, [], [])
    expect(user).not.toMatch(/avoid repeating/i)
  })

  it('quotes real prior idea text back into the prompt as explicit negative examples', () => {
    const priorIdea = 'A field service management platform that automates scheduling and invoicing for tradespeople.'
    const { user } = buildSurpriseIdeaPrompt(CATALOG, [], [priorIdea])
    expect(user).toMatch(/avoid repeating or closely resembling/i)
    expect(user).toContain(priorIdea)
  })

  it('includes every idea across sequential calls building up a real session history (the per-user case #755 requires)', () => {
    // Simulate 3 consecutive "Surprise me" clicks in one sitting: each call's
    // prompt must carry the REAL text of every idea already shown this
    // session, not a primitive-category proxy — this is the non-negotiable
    // per-user constraint from the issue.
    const idea1 = 'A field service management platform that automates scheduling and invoicing for tradespeople.'
    const idea2 = 'A field service management platform that automates work order forms and technician dispatch.'
    const call2 = buildSurpriseIdeaPrompt(CATALOG, [], [idea1])
    expect(call2.user).toContain(idea1)

    const call3 = buildSurpriseIdeaPrompt(CATALOG, [], [idea1, idea2])
    expect(call3.user).toContain(idea1)
    expect(call3.user).toContain(idea2)
  })

  it('only sends the most recent RECENT_IDEA_TEXT_WINDOW prior ideas, dropping older ones', () => {
    const ideas = Array.from({ length: RECENT_IDEA_TEXT_WINDOW + 3 }, (_, i) => `Idea number ${i} about a fake business.`)
    const { user } = buildSurpriseIdeaPrompt(CATALOG, [], ideas)
    expect(user).not.toContain(ideas[0])
    expect(user).toContain(ideas[ideas.length - 1])
  })

  it('ignores blank/empty entries in the prior-idea array rather than surfacing them as fake negative examples', () => {
    const { user } = buildSurpriseIdeaPrompt(CATALOG, [], ['', '   ', 'A real idea about a real business that does real things.'])
    expect(user).toContain('A real idea about a real business that does real things.')
  })

  it('keeps the primitive-category steer alongside the concept-similarity steer — both signals present together', () => {
    const priorIdea = 'A cap-table tool for SAFEs.'
    const { user } = buildSurpriseIdeaPrompt(CATALOG, [], [priorIdea])
    expect(user).toMatch(/UNDERREPRESENTED/)
    expect(user).toContain(priorIdea)
  })
})

describe('sanitizeSurpriseIdea', () => {
  it('strips wrapping double quotes', () => {
    expect(sanitizeSurpriseIdea('"An app that does things."')).toBe('An app that does things.')
  })

  it('strips wrapping single quotes', () => {
    expect(sanitizeSurpriseIdea("'An app that does things.'")).toBe('An app that does things.')
  })

  it('strips a markdown bullet/number prefix', () => {
    expect(sanitizeSurpriseIdea('1. An app that does things.')).toBe('An app that does things.')
    expect(sanitizeSurpriseIdea('- An app that does things.')).toBe('An app that does things.')
  })

  it('takes only the first line of a multi-line completion', () => {
    expect(sanitizeSurpriseIdea('An app that does things.\nHere is why this is a good idea...')).toBe(
      'An app that does things.',
    )
  })

  it('truncates a runaway completion to a sane length', () => {
    const huge = 'A '.repeat(500)
    expect(sanitizeSurpriseIdea(huge).length).toBeLessThanOrEqual(400)
  })

  it('handles empty/missing input without throwing', () => {
    expect(sanitizeSurpriseIdea('')).toBe('')
    expect(sanitizeSurpriseIdea(undefined as unknown as string)).toBe('')
  })
})

describe('isUsableSurpriseIdea', () => {
  it('accepts a normal-length idea sentence', () => {
    expect(isUsableSurpriseIdea('A support copilot that resolves tickets from your knowledge base.')).toBe(true)
  })

  it('rejects an empty or too-short completion', () => {
    expect(isUsableSurpriseIdea('')).toBe(false)
    expect(isUsableSurpriseIdea('short')).toBe(false)
  })

  it('rejects a completion with no letters (garbage/empty-ish output)', () => {
    expect(isUsableSurpriseIdea('12345678901234567890')).toBe(false)
  })

  it('rejects an absurdly long completion', () => {
    expect(isUsableSurpriseIdea('A '.repeat(300))).toBe(false)
  })
})
