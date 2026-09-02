import { describe, it, expect } from 'vitest'
import { SURPRISE_IDEAS, pickSurpriseIdea } from '@/lib/build/surprise-ideas'

/**
 * "Surprise me" idea selection (BuildStart.tsx). Real production bug this
 * fixes: the previous pool was 5 ideas, selected via
 * Math.floor(Date.now()/60000) % 5 — deterministic and clock-bucketed, so
 * clicking "Surprise me" repeatedly within the same minute always returned
 * the IDENTICAL idea, and even across minutes there were only 5 possible
 * outcomes total, cycling in a fixed, guessable order.
 */

describe('SURPRISE_IDEAS pool', () => {
  it('has real variety — significantly more than the previous 5-idea pool', () => {
    expect(SURPRISE_IDEAS.length).toBeGreaterThanOrEqual(10)
  })
  it('every idea is unique — no accidental duplicates', () => {
    expect(new Set(SURPRISE_IDEAS).size).toBe(SURPRISE_IDEAS.length)
  })
})

describe('pickSurpriseIdea', () => {
  it('returns a real idea from the pool', () => {
    const idea = pickSurpriseIdea(null, () => 0.5)
    expect(SURPRISE_IDEAS).toContain(idea)
  })

  it('is driven by the injected random source (deterministic for a fixed rand)', () => {
    // rand() = 0 always picks index 0.
    expect(pickSurpriseIdea(null, () => 0)).toBe(SURPRISE_IDEAS[0])
  })

  it('picks a DIFFERENT idea across two calls with different random values (the real bug: previously always identical)', () => {
    const a = pickSurpriseIdea(null, () => 0.1)
    const b = pickSurpriseIdea(null, () => 0.9)
    expect(a).not.toBe(b)
  })

  it('re-rolls once when the first pick would immediately repeat the previous idea', () => {
    const previous = SURPRISE_IDEAS[0]
    let call = 0
    const rand = () => {
      call += 1
      // First call picks index 0 (the repeat); second call picks index 1.
      return call === 1 ? 0 : 1 / SURPRISE_IDEAS.length
    }
    const idea = pickSurpriseIdea(previous, rand)
    expect(idea).not.toBe(previous)
    expect(idea).toBe(SURPRISE_IDEAS[1])
  })

  it('never throws or loops forever when previous is null (first-ever pick)', () => {
    expect(() => pickSurpriseIdea(null, () => 0)).not.toThrow()
  })

  it('a full random spread across many calls covers more than one idea (real, not just theoretical, variety)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      seen.add(pickSurpriseIdea(null, Math.random))
    }
    expect(seen.size).toBeGreaterThan(1)
  })
})
