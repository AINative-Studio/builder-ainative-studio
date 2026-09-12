import { describe, it, expect } from 'vitest'
import { shouldShowPricingNudge, recordPricingNudgeShown, MAX_SHOWN, PRICING_NUDGE_KEY, type StorageLike } from '@/lib/build/pricing-nudge'

/**
 * #653 — usage-based pricing is never communicated in-product. The autopilot
 * placement is a wait-time nudge: novel on the first run, noise by the
 * fourth (the issue's own constraint), so it's capped at MAX_SHOWN total
 * showings per browser rather than shown on every build.
 */

function memoryStore(initial: Record<string, string> = {}): StorageLike {
  const data = { ...initial }
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = v },
  }
}

describe('pricing-nudge (#653)', () => {
  it('shows on a fresh browser with no prior showings', () => {
    expect(shouldShowPricingNudge(memoryStore())).toBe(true)
  })

  it('shows nothing when storage is unavailable (SSR / private mode) — a missing nudge is harmless', () => {
    expect(shouldShowPricingNudge(null)).toBe(false)
    expect(shouldShowPricingNudge(undefined)).toBe(false)
  })

  it('keeps showing until MAX_SHOWN is reached', () => {
    const store = memoryStore()
    for (let i = 0; i < MAX_SHOWN; i++) {
      expect(shouldShowPricingNudge(store)).toBe(true)
      recordPricingNudgeShown(store)
    }
    expect(shouldShowPricingNudge(store)).toBe(false)
  })

  it('never shows again once the cap is exceeded, even if called repeatedly', () => {
    const store = memoryStore({ [PRICING_NUDGE_KEY]: String(MAX_SHOWN + 5) })
    expect(shouldShowPricingNudge(store)).toBe(false)
  })

  it('treats corrupted stored counts as zero rather than throwing', () => {
    const store = memoryStore({ [PRICING_NUDGE_KEY]: 'not-a-number' })
    expect(shouldShowPricingNudge(store)).toBe(true)
  })

  it('recordPricingNudgeShown increments monotonically and persists', () => {
    const store = memoryStore()
    recordPricingNudgeShown(store)
    recordPricingNudgeShown(store)
    expect(store.getItem(PRICING_NUDGE_KEY)).toBe('2')
  })

  it('recordPricingNudgeShown on null/undefined storage is a safe no-op', () => {
    expect(() => recordPricingNudgeShown(null)).not.toThrow()
    expect(() => recordPricingNudgeShown(undefined)).not.toThrow()
  })
})
