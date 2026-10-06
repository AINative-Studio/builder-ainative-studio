import { describe, it, expect } from 'vitest'
import { pickCardDescription } from '@/app/showcase/showcase-client'

/**
 * #955 follow-up — found live right after the main fix shipped: the "All
 * Businesses" grid's CommunityCard was calling cleanDescription(entry.prompt,
 * ...) directly, ignoring entry.description entirely. /api/showcase already
 * computes entry.description correctly via generateDescription() (also
 * fixed under #955) -- cleanDescription's own cleanup is much weaker and
 * left raw internal prompt template syntax (including "(tagline: ...)")
 * showing in the public UI. pickCardDescription prefers the already-correct
 * server value, falling back to cleanDescription only when it's missing.
 */
describe('pickCardDescription (#955 follow-up)', () => {
  it('prefers entry.description when present, even if it differs from a cleaned prompt', () => {
    const entry = {
      description: 'Wrench — a real business built by describing this idea to Cody: automates scheduling.',
      prompt: 'Build a polished, production-quality single-page marketing LANDING PAGE for "Wrench" (tagline: "From Job Site To Paid — on autopilot.") — a real company for this idea: automates scheduling.',
    }
    expect(pickCardDescription(entry, 'Wrench')).toBe(
      'Wrench — a real business built by describing this idea to Cody: automates scheduling.',
    )
  })

  it('never lets raw prompt template syntax ("(tagline:") reach the UI when a real description exists', () => {
    const entry = {
      description: 'Shutter — a real business built by describing this idea to Cody: photography workspace.',
      prompt: 'Build a polished, production-quality single-page marketing LANDING PAGE for "Shutter" (tagline: "From First Proof To Final Payment.") — a real company for this idea: photography workspace.',
    }
    expect(pickCardDescription(entry, 'Shutter')).not.toContain('tagline')
  })

  it('falls back to a cleaned prompt when entry.description is missing', () => {
    const entry = { prompt: 'Build a todo list app with drag and drop.' }
    const result = pickCardDescription(entry, 'Todo List App')
    expect(result).toContain('todo list app')
  })

  it('falls back to a generic line when both description and prompt are missing', () => {
    const entry = {}
    expect(pickCardDescription(entry, 'Untitled')).toBe('A real business, built by describing this idea to Cody')
  })
})
