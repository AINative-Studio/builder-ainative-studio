import { describe, it, expect } from 'vitest'
import {
  feedbackInstruction,
  collectPrior,
  serializeArtifact,
  applyEdit,
  FEEDBACK_MAX_CHARS,
} from '@/lib/build/artifact-edit'
import { buildReducer, initialBuildState } from '@/lib/build/state'

/**
 * lib/build/artifact-edit — pure logic for GR-16 (#329): per-artifact
 * regenerate (feedback-prompt composition, prior collection) and inline edit
 * (serialize/apply round-trip), plus the EDIT_ARTIFACT reducer wiring.
 */

describe('feedbackInstruction', () => {
  it('returns empty string for undefined / null / blank feedback', () => {
    expect(feedbackInstruction(undefined)).toBe('')
    expect(feedbackInstruction(null)).toBe('')
    expect(feedbackInstruction('')).toBe('')
    expect(feedbackInstruction('   \n\t ')).toBe('')
  })

  it('wraps trimmed feedback in a prompt block', () => {
    const out = feedbackInstruction('  Make the pricing tiers cheaper.  ')
    expect(out).toContain('"""Make the pricing tiers cheaper."""')
    expect(out).toContain('founder reviewed the previous draft')
    // Appended to an existing user prompt — must start on a new paragraph.
    expect(out.startsWith('\n\n')).toBe(true)
  })

  it('clips feedback to FEEDBACK_MAX_CHARS', () => {
    const long = 'x'.repeat(FEEDBACK_MAX_CHARS + 500)
    const out = feedbackInstruction(long)
    expect(out).toContain('x'.repeat(FEEDBACK_MAX_CHARS))
    expect(out).not.toContain('x'.repeat(FEEDBACK_MAX_CHARS + 1))
  })
})

describe('collectPrior', () => {
  const seq = ['thesis', 'wedge', 'businessModel'] as const
  const generated = {
    thesis: { problem: 'p' },
    businessModel: { tiers: [] },
    // not in seq — must never leak into prior
    prd: { overview: 'o' },
  }

  it('collects generated views in sequence order, excluding the regenerated view', () => {
    expect(collectPrior(seq, generated, 'businessModel')).toEqual({ thesis: { problem: 'p' } })
  })

  it('includes other generated views when excluding a non-generated one', () => {
    expect(collectPrior(seq, generated, 'wedge')).toEqual({
      thesis: { problem: 'p' },
      businessModel: { tiers: [] },
    })
  })

  it('skips undefined and null entries', () => {
    expect(collectPrior(seq, { thesis: null as unknown, wedge: undefined }, 'businessModel')).toEqual({})
  })

  it('never includes views outside the sequence', () => {
    const prior = collectPrior(seq, generated, 'thesis')
    expect(prior).not.toHaveProperty('prd')
  })
})

describe('serializeArtifact', () => {
  it('returns empty string for null / undefined', () => {
    expect(serializeArtifact(null)).toBe('')
    expect(serializeArtifact(undefined)).toBe('')
  })

  it('returns strings as-is', () => {
    expect(serializeArtifact('raw text')).toBe('raw text')
  })

  it('pretty-prints objects as JSON', () => {
    const s = serializeArtifact({ a: 1, b: ['x'] })
    expect(JSON.parse(s)).toEqual({ a: 1, b: ['x'] })
    expect(s).toContain('\n') // 2-space pretty print, editable in a textarea
  })

  it('falls back to String() for unserializable content (circular)', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(serializeArtifact(circular)).toBe('[object Object]')
  })
})

describe('applyEdit', () => {
  it('rejects empty / whitespace-only edits', () => {
    const r = applyEdit({ a: 1 }, '   \n ')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/empty/i)
  })

  it('parses valid JSON edits over structured content', () => {
    const r = applyEdit({ a: 1 }, '{\n  "a": 2,\n  "b": "new"\n}')
    expect(r).toEqual({ ok: true, content: { a: 2, b: 'new' } })
  })

  it('accepts JSON array edits over array content', () => {
    const r = applyEdit(['x'], '["y","z"]')
    expect(r).toEqual({ ok: true, content: ['y', 'z'] })
  })

  it('rejects invalid JSON over structured content instead of corrupting it', () => {
    const r = applyEdit({ a: 1 }, 'not json at all')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/JSON/i)
  })

  it('rejects a JSON scalar over structured content (body would stop rendering)', () => {
    const r = applyEdit({ a: 1 }, '"just a string"')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/JSON object/i)
  })

  it('stores trimmed plain text when the original is a string', () => {
    const r = applyEdit('old text', '  new text  ')
    expect(r).toEqual({ ok: true, content: 'new text' })
  })
})

describe('buildReducer EDIT_ARTIFACT', () => {
  it('replaces generated content, clears genError, and marks the view edited', () => {
    const base = {
      ...initialBuildState,
      generated: { prd: { overview: 'old' }, brief: { summary: 's' } },
      genError: { prd: 'boom' },
      done: { prd: 'done', brief: 'done' },
    }
    const next = buildReducer(base, {
      type: 'EDIT_ARTIFACT',
      view: 'prd',
      content: { overview: 'new' },
    })
    expect(next.generated.prd).toEqual({ overview: 'new' })
    expect(next.generated.brief).toEqual({ summary: 's' }) // untouched
    expect(next.genError.prd).toBe('')
    expect(next.done.prd).toBe('edited')
    expect(next.done.brief).toBe('done')
  })

  it('does not disturb unrelated state', () => {
    const base = { ...initialBuildState, idea: 'my idea', companyName: 'Acme' }
    const next = buildReducer(base, { type: 'EDIT_ARTIFACT', view: 'thesis', content: { x: 1 } })
    expect(next.idea).toBe('my idea')
    expect(next.companyName).toBe('Acme')
    expect(next.screen).toBe(base.screen)
  })
})
