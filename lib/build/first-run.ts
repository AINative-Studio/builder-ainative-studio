/**
 * First-run guide logic (#319 GR-10 — "Turn on the computer").
 *
 * A first-time founder who lands in the workspace mid-build has zero context:
 * they don't know they should just watch, answer decisions, and click the
 * preview. This module decides whether to show the one-time coach strip and
 * records the dismissal so it never appears again.
 *
 * Pure and storage-agnostic: callers pass any storage-like object (in the
 * browser, window.localStorage; in tests, an in-memory stub). Every call is
 * wrapped so private mode / quota errors are non-fatal — on any storage
 * failure we default to SHOWING the guide (a redundant strip is harmless;
 * a stranded first-timer is not).
 */

/** Minimal storage surface — satisfied by window.localStorage and test stubs. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** localStorage key marking that the founder has seen (and dismissed) the guide. */
export const FIRST_RUN_KEY = 'ainative-first-run-seen'

/**
 * True when the coach strip should render — i.e. the founder has never
 * dismissed it. Absent/null storage (SSR) shows the guide: hydration on the
 * client re-checks with real localStorage before anything is persisted.
 */
export function shouldShowFirstRun(store: StorageLike | null | undefined): boolean {
  if (!store) return true
  try {
    return store.getItem(FIRST_RUN_KEY) === null
  } catch {
    return true
  }
}

/** Record the dismissal so the guide never shows again on this browser. */
export function markFirstRunSeen(store: StorageLike | null | undefined): void {
  if (!store) return
  try {
    store.setItem(FIRST_RUN_KEY, '1')
  } catch {
    /* private mode / quota — non-fatal, the strip stays dismissed in memory */
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
