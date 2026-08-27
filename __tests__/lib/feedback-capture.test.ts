/**
 * Tests for lib/build/feedback-capture.ts (#332 DATA-1) — key derivation,
 * payload building against the exact /api/rlhf/submit-feedback contract,
 * and the once-per-generation logic.
 */
import { describe, it, expect } from 'vitest'
import {
  FEEDBACK_KEY_PREFIX,
  RATING_UP,
  RATING_DOWN,
  generationId,
  feedbackKey,
  hasRated,
  markRated,
  composeTrainingPrompt,
  buildFeedbackPayload,
  shouldShowPulse,
  browserStorage,
  type FeedbackContext,
  type StorageLike,
} from '@/lib/build/feedback-capture'

function memoryStore(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    setItem: (k, v) => { data.set(k, v) },
  }
}

function throwingStore(): StorageLike {
  return {
    getItem: () => { throw new Error('quota') },
    setItem: () => { throw new Error('quota') },
  }
}

const ctx: FeedbackContext = {
  chatId: 'chat-abc123',
  slug: 'acme-notes',
  idea: 'A note app for landscapers',
  track: 'app',
  view: 'preview',
  surface: 'preview',
}

describe('generationId', () => {
  it('prefers the chatId when present', () => {
    expect(generationId({ chatId: 'c1', slug: 's1' })).toBe('c1')
  })

  it('falls back to a slug-scoped id when only the slug exists', () => {
    expect(generationId({ slug: 'acme' })).toBe('slug:acme')
    expect(generationId({ chatId: '', slug: 'acme' })).toBe('slug:acme')
  })

  it('trims whitespace-only identifiers', () => {
    expect(generationId({ chatId: '   ', slug: '  ' })).toBeNull()
    expect(generationId({ chatId: '  c1 ', slug: '' })).toBe('c1')
  })

  it('is null when the generation is unidentifiable', () => {
    expect(generationId({})).toBeNull()
    expect(generationId({ chatId: undefined, slug: undefined })).toBeNull()
  })
})

describe('feedbackKey', () => {
  it('namespaces the generation id under the feedback prefix', () => {
    expect(feedbackKey({ chatId: 'c1' })).toBe(`${FEEDBACK_KEY_PREFIX}:c1`)
    expect(feedbackKey({ slug: 'acme' })).toBe(`${FEEDBACK_KEY_PREFIX}:slug:acme`)
  })

  it('is null for an unidentifiable generation', () => {
    expect(feedbackKey({})).toBeNull()
  })
})

describe('once-only logic (hasRated / markRated / shouldShowPulse)', () => {
  it('shows the pulse for a fresh identifiable generation', () => {
    const store = memoryStore()
    expect(hasRated(store, ctx)).toBe(false)
    expect(shouldShowPulse(store, ctx)).toBe(true)
  })

  it('never shows the pulse again after markRated', () => {
    const store = memoryStore()
    markRated(store, ctx)
    expect(hasRated(store, ctx)).toBe(true)
    expect(shouldShowPulse(store, ctx)).toBe(false)
  })

  it('keys ratings per generation — a NEW chatId asks again', () => {
    const store = memoryStore()
    markRated(store, { chatId: 'gen-1' })
    expect(shouldShowPulse(store, { chatId: 'gen-1' })).toBe(false)
    expect(shouldShowPulse(store, { chatId: 'gen-2' })).toBe(true)
  })

  it('chatId and slug fallbacks are distinct keys', () => {
    const store = memoryStore()
    markRated(store, { slug: 'acme' })
    expect(shouldShowPulse(store, { slug: 'acme' })).toBe(false)
    expect(shouldShowPulse(store, { chatId: 'acme' })).toBe(true)
  })

  it('never renders for an unidentifiable generation', () => {
    const store = memoryStore()
    expect(shouldShowPulse(store, {})).toBe(false)
    markRated(store, {}) // no-op, must not throw or write
    expect(store.data.size).toBe(0)
  })

  it('null/absent storage says not-rated (shows the pulse)', () => {
    expect(hasRated(null, ctx)).toBe(false)
    expect(shouldShowPulse(undefined, ctx)).toBe(true)
    markRated(null, ctx) // must not throw
  })

  it('broken storage (private mode / quota) is non-fatal both ways', () => {
    const store = throwingStore()
    expect(hasRated(store, ctx)).toBe(false)
    expect(shouldShowPulse(store, ctx)).toBe(true)
    expect(() => markRated(store, ctx)).not.toThrow()
  })
})

describe('composeTrainingPrompt', () => {
  it('leads with the idea and appends the machine-readable context line', () => {
    const prompt = composeTrainingPrompt(ctx)
    expect(prompt.startsWith('A note app for landscapers\n')).toBe(true)
    expect(prompt).toContain('[builder track=app view=preview slug=acme-notes surface=preview]')
  })

  it('omits absent context tags but always tags the surface', () => {
    const prompt = composeTrainingPrompt({ surface: 'live' })
    expect(prompt).toBe('[builder surface=live]')
  })

  it('trims the idea', () => {
    const prompt = composeTrainingPrompt({ idea: '  x  ', surface: 'live' })
    expect(prompt).toBe('x\n[builder surface=live]')
  })
})

describe('buildFeedbackPayload', () => {
  it('builds the exact API contract for a positive rating', () => {
    const p = buildFeedbackPayload(ctx, true)
    expect(p).toEqual({
      chatId: 'chat-abc123',
      rating: RATING_UP,
      feedbackText: '',
      prompt: composeTrainingPrompt(ctx),
      model: '',
    })
  })

  it('maps a negative rating to the API down value with the reason text', () => {
    const p = buildFeedbackPayload(ctx, false, '  wrong color scheme  ')
    expect(p?.rating).toBe(RATING_DOWN)
    expect(p?.feedbackText).toBe('wrong color scheme')
  })

  it('uses the API rating scale (5 = up, 1 = down — matches zerodb-store)', () => {
    expect(RATING_UP).toBe(5)
    expect(RATING_DOWN).toBe(1)
  })

  it('falls back to the slug generation id when no chatId', () => {
    const p = buildFeedbackPayload({ ...ctx, chatId: undefined }, true)
    expect(p?.chatId).toBe('slug:acme-notes')
  })

  it('carries the model through when known', () => {
    const p = buildFeedbackPayload({ ...ctx, model: 'bedrock-opus' }, true)
    expect(p?.model).toBe('bedrock-opus')
  })

  it('is null when the generation is unidentifiable (route would 400)', () => {
    expect(buildFeedbackPayload({ surface: 'preview' }, true)).toBeNull()
  })
})

describe('browserStorage', () => {
  it('returns null outside a browser (node test env has no window)', () => {
    expect(browserStorage()).toBeNull()
  })
})
