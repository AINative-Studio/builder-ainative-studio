/**
 * Live dashboard middle-column section collapse preference (#803).
 *
 * Root cause of the recurring "grey region grows as you scroll" bug (#484,
 * #754, and again live 2026-09-21): the middle column's rendered height has
 * no bound — it's the sum of every section's full-open height, which only
 * grows as more sections are added over time, while the right column (the
 * Cody chat rail) is position:sticky with a height capped to the viewport.
 * Each prior fix patched that round's specific height-calc mismatch, never
 * the structural cause. This lets a founder collapse sections they don't
 * need right now, bounding the column's real height on demand, instead of
 * only ever growing.
 *
 * Sections default OPEN (nothing should look newly hidden/broken on first
 * load after this ships) and persist per-project (localStorage, keyed by
 * company slug + section id) — mirrors artifact-rail-prefs.ts's own
 * per-project persistence model for the same reason: a returning founder
 * sees exactly the layout they last left the project in.
 */

const STORAGE_PREFIX = 'ainative-builder-live-section-'

function storage(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  return window.localStorage
}

/** Is this section open for this project? Defaults to true (open) when never set. */
export function isSectionOpen(slug: string, sectionId: string): boolean {
  const s = storage()
  if (!s || !slug || !sectionId) return true
  try {
    const raw = s.getItem(STORAGE_PREFIX + slug + '-' + sectionId)
    if (raw === null) return true
    return raw === '1'
  } catch {
    return true
  }
}

export function saveSectionOpen(slug: string, sectionId: string, open: boolean): void {
  const s = storage()
  if (!s || !slug || !sectionId) return
  try {
    s.setItem(STORAGE_PREFIX + slug + '-' + sectionId, open ? '1' : '0')
  } catch {
    /* best-effort */
  }
}
