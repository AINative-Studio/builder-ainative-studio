import { describe, it, expect } from 'vitest'
import { detectEditIntent } from '@/lib/build/edit-intent'

describe('detectEditIntent (#582)', () => {
  it('detects a plain imperative edit request', () => {
    expect(detectEditIntent('change the hero headline to Grow Faster')).toBe(true)
    expect(detectEditIntent('add a dark mode toggle')).toBe(true)
    expect(detectEditIntent('remove the pricing section')).toBe(true)
    expect(detectEditIntent('fix the broken signup button')).toBe(true)
  })

  it('accepts a leading please/cody address', () => {
    expect(detectEditIntent('please change the primary color to blue')).toBe(true)
    expect(detectEditIntent('cody, add a footer link to our terms page')).toBe(true)
    expect(detectEditIntent('hey cody can you fix the logo size')).toBe(false) // "can you" -> question phrasing
  })

  it('does NOT flag a plain question about the app', () => {
    expect(detectEditIntent('what does this app do')).toBe(false)
    expect(detectEditIntent('why isn\'t my domain live yet')).toBe(false)
    expect(detectEditIntent('how do I change the color scheme?')).toBe(false)
    expect(detectEditIntent('can you change the headline?')).toBe(false)
    expect(detectEditIntent('is the data really persisting')).toBe(false)
  })

  it('does NOT flag anything ending in a question mark, even if it opens with a verb-like word', () => {
    expect(detectEditIntent('add a feature like that?')).toBe(false)
  })

  it('does NOT flag empty or whitespace-only input', () => {
    expect(detectEditIntent('')).toBe(false)
    expect(detectEditIntent('   ')).toBe(false)
  })

  it('does NOT flag unrelated statements with no edit verb', () => {
    expect(detectEditIntent('I love what you built so far')).toBe(false)
    expect(detectEditIntent('thanks for the help')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(detectEditIntent('CHANGE THE HEADLINE')).toBe(true)
    expect(detectEditIntent('Add A Newsletter Signup')).toBe(true)
  })
})
