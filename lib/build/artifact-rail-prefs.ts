/**
 * Artifact rail expand/collapse preference (#652).
 *
 * Default behavior is a nested accordion (each category collapsed) so a
 * large finished project stays scannable. While Cody is actively driving the
 * build (state.auto === true — see lib/build/state.ts), every category
 * forces open instead: new output during an active run would otherwise
 * render inside a section the founder never opened, so "new artifact
 * appeared" is invisible rather than one extra click away.
 *
 * The forced-open behavior only applies until the founder makes their own
 * explicit choice mid-run (collapsing a category they don't care about right
 * now) — from that moment on, the system never overrides it again for the
 * rest of that run. This is tracked as a one-shot "explicit override started"
 * flag per browser session (sessionStorage — a page reload mid-run is rare
 * enough not to warrant persisting the override past the tab's lifetime, and
 * doing so would make the override ambiguously "for this run" vs "forever").
 *
 * The actual expand/collapse map is persisted per-project (localStorage,
 * keyed by company slug) so a returning founder sees exactly the layout they
 * last left the project in, matching the third acceptance criterion.
 */

const STORAGE_PREFIX = 'ainative-builder-artifact-rail-'
const OVERRIDE_SESSION_PREFIX = 'ainative-builder-artifact-rail-override-'

function storage(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  return window.localStorage
}

function sessionStore(): Storage | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null
  return window.sessionStorage
}

/** Categories the founder has explicitly collapsed for this project. */
export function loadCollapsedCategories(slug: string): string[] {
  const s = storage()
  if (!s || !slug) return []
  try {
    const raw = s.getItem(STORAGE_PREFIX + slug)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function saveCollapsedCategories(slug: string, collapsed: string[]): void {
  const s = storage()
  if (!s || !slug) return
  try {
    s.setItem(STORAGE_PREFIX + slug, JSON.stringify(collapsed))
  } catch {
    /* best-effort */
  }
}

/** Has the founder made an explicit expand/collapse choice during THIS run? */
export function hasExplicitOverrideThisRun(slug: string): boolean {
  const s = sessionStore()
  if (!s || !slug) return false
  return s.getItem(OVERRIDE_SESSION_PREFIX + slug) === '1'
}

export function markExplicitOverrideThisRun(slug: string): void {
  const s = sessionStore()
  if (!s || !slug) return
  try {
    s.setItem(OVERRIDE_SESSION_PREFIX + slug, '1')
  } catch {
    /* best-effort */
  }
}

export function clearExplicitOverrideThisRun(slug: string): void {
  const s = sessionStore()
  if (!s || !slug) return
  try {
    s.removeItem(OVERRIDE_SESSION_PREFIX + slug)
  } catch {
    /* best-effort */
  }
}

/**
 * Pure decision: is this category's body visible right now?
 *
 * - Cody actively driving AND the founder hasn't overridden anything yet
 *   this run → force expanded (true), regardless of the persisted preference.
 * - Otherwise → the persisted per-project preference (not in the collapsed
 *   set = expanded), which is exactly what an idle return-visit should show.
 */
export function isCategoryExpanded(
  category: string,
  collapsed: string[],
  autoBuildActive: boolean,
  overriddenThisRun: boolean,
): boolean {
  if (autoBuildActive && !overriddenThisRun) return true
  return !collapsed.includes(category)
}
