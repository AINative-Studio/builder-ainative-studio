/**
 * Usage-based pricing nudge during autopilot (#653).
 *
 * Nothing in the product states that pricing is usage-based rather than
 * seat-based — developers default to assuming per-seat pricing (most tools
 * are priced that way) and self-select out before ever reaching a usage
 * limit. The autopilot screen (Cody visibly building) is high-leverage real
 * estate for this: the founder is watching substantial work happen, so
 * "this counts against usage, not headcount" lands harder than a generic
 * pricing line.
 *
 * Wait-time placements degrade fast — novel on the first run, noise by the
 * fourth. This caps it at MAX_SHOWN times total, tracked per-browser
 * (localStorage, matching first-run.ts's StorageLike pattern so it's
 * testable without a real browser).
 */

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const PRICING_NUDGE_KEY = 'ainative-builder-pricing-nudge-shown-count'

/** Cap from the issue's own constraint: novel early, noise past a few builds. */
export const MAX_SHOWN = 3

function readCount(store: StorageLike): number {
  try {
    const raw = store.getItem(PRICING_NUDGE_KEY)
    const n = raw === null ? 0 : parseInt(raw, 10)
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

/**
 * True when the autopilot pricing nudge should render this run. Absent
 * storage (SSR) shows nothing — a missing strip is harmless; this is a nice-
 * to-have message, not a first-timer coach strip that must never be missed.
 */
export function shouldShowPricingNudge(store: StorageLike | null | undefined): boolean {
  if (!store) return false
  return readCount(store) < MAX_SHOWN
}

/** Record one more showing. Call once per mount, not once per render. */
export function recordPricingNudgeShown(store: StorageLike | null | undefined): void {
  if (!store) return
  try {
    store.setItem(PRICING_NUDGE_KEY, String(readCount(store) + 1))
  } catch {
    /* private mode / quota — non-fatal */
  }
}

/** Browser localStorage when available, else null (SSR / private mode). */
export function browserStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}
