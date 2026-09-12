/**
 * Active-build resume pointer (#669).
 *
 * `saveBuildState`/`loadBuildState` in build-context.tsx already persist full
 * build state to localStorage — but keyed by company slug, and only ever READ
 * back when the URL already carries `?screen=...&company={slug}` (a deep
 * link). A genuinely bare reload or fresh tab of /build (no query params —
 * confirmed live, issue #669: a signed-in founder mid-generation who reloads
 * or opens a new tab) never looks the slug up at all, so the founder lands on
 * the public landing screen with no indication their build is still running.
 *
 * `BuildApp.tsx`'s ScreenRouter separately tries to catch this via
 * `/api/build/my-companies`, but that list is populated by registerApp(),
 * which doesn't run until code generation actually reaches 'complete' —
 * useless for the artifact-drafting/autoplay stage #669 was filed against.
 *
 * Fix: a tiny, single-fixed-key pointer (mirrors pending-build.ts's existing
 * pattern for the same "resume with no slug available" problem) recording
 * just enough — the slug and current screen — to find and restore the real,
 * per-slug persisted state on an unconditional mount check. Cleared once the
 * build reaches its terminal 'live' screen (registerApp has run by then, so
 * MyCompanies/my-companies already covers the founder from that point on).
 */

export interface ActiveBuildPointer {
  slug: string
  screen: string
}

const KEY = 'ainative_active_build'

export function saveActiveBuild(pointer: ActiveBuildPointer): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(KEY, JSON.stringify(pointer))
  } catch {
    /* private mode / quota — non-fatal */
  }
}

export function loadActiveBuild(): ActiveBuildPointer | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<ActiveBuildPointer>
    if (!p || typeof p.slug !== 'string' || !p.slug || typeof p.screen !== 'string' || !p.screen) {
      return null
    }
    return { slug: p.slug, screen: p.screen }
  } catch {
    return null
  }
}

export function clearActiveBuild(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.removeItem(KEY)
  } catch {
    /* non-fatal */
  }
}
