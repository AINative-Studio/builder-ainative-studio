'use client'

/**
 * Forces the Live dashboard's three-column grid to a real, equal floor height
 * so no column ever exposes the grid's grey divider background below its own
 * shorter content (#805 recurrence — the 4th time this exact symptom has been
 * reported: #484, #754, #803).
 *
 * Why this exists: `.m-live-grid` uses `align-items: start` (each column
 * sized to its own natural content height, not stretched) — a deliberate
 * choice, since the right column (`.m-live-col-chat`) is `position: sticky`
 * and self-caps its own height against the viewport (see useHeaderHeightVar),
 * not against its siblings. But that same `align-items: start` guarantees the
 * LEFT and MIDDLE columns are never equal height either, since their content
 * differs and grows independently over time (#803 added a collapsible-
 * section accordion to bound the middle column, and relocated the "Business
 * systems" card into the left column — but that only changed which column
 * ends up shorter, it didn't remove the height mismatch itself). Whichever
 * non-sticky column is shortest exposes `.m-live-grid`'s own grey background
 * once the founder scrolls past its end.
 *
 * Each prior fix (#484, #754, #803) patched a specific column's own height
 * calculation — a hardcoded constant, then a runtime-measured constant, then
 * a content relocation — and each time the underlying cause (three
 * independently-sized columns with no shared floor) reasserted itself in a
 * new shape. This hook instead measures the real rendered height of the
 * LEFT and MIDDLE columns (mirroring useHeaderHeightVar's ResizeObserver
 * pattern) and writes the taller of the two as a shared `min-height` custom
 * property both columns read — so neither can ever be shorter than the
 * other, regardless of what content either one gains in the future.
 *
 * #842: the chat column (`.m-live-col-chat`) now ALSO reads this shared
 * `min-height` var (its own sticky/height-capped box moved to an inner
 * wrapper, see modernist.css and Live.tsx) so it can cover the full grid
 * cell too. But `--live-col-min-h` was previously written only as an
 * INLINE style on the left/middle column elements themselves — CSS custom
 * properties inherit to DESCENDANTS, not siblings, so the chat column
 * (a sibling of both) never actually received it. Writing the var on an
 * ANCESTOR of all three columns instead (`writeRef` — pass the same
 * `containerRef` used by useHeaderHeightVar, which already wraps the whole
 * `.m-live-grid`) makes it visible to every column via normal inheritance,
 * with no change needed to the measurement logic itself.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react'

export const LIVE_COL_MIN_HEIGHT_VAR = '--live-col-min-h'

export function useEqualColumnHeight<E extends HTMLElement = HTMLDivElement>(
  varName: string = LIVE_COL_MIN_HEIGHT_VAR,
  writeRef?: RefObject<HTMLElement | null>,
): {
  leftColRef: RefObject<E | null>
  middleColRef: RefObject<E | null>
} {
  const leftColRef = useRef<E | null>(null)
  const middleColRef = useRef<E | null>(null)

  useLayoutEffect(() => {
    const leftEl = leftColRef.current
    const middleEl = middleColRef.current
    if (!leftEl || !middleEl) return
    // Falls back to the left column itself when no shared ancestor is
    // given, preserving the original (left/middle-only) behavior for any
    // other caller of this hook.
    const target = writeRef?.current ?? leftEl

    const apply = () => {
      // Reset to auto first so a shrinking column (a collapsed accordion
      // section) can actually shrink the measured scrollHeight — otherwise
      // the previous min-height would keep inflating its own scrollHeight
      // and the shared max could only ever grow, never shrink back down.
      leftEl.style.minHeight = ''
      middleEl.style.minHeight = ''
      const h = Math.max(leftEl.scrollHeight, middleEl.scrollHeight)
      target.style.setProperty(varName, `${h}px`)
    }

    apply()

    if (typeof ResizeObserver === 'undefined') return
    // Observe both columns: either one's content (accordion collapse/expand,
    // async data mounting in, a new card) can change which is taller.
    const ro = new ResizeObserver(apply)
    ro.observe(leftEl)
    ro.observe(middleEl)
    return () => ro.disconnect()
  }, [varName, writeRef])

  return { leftColRef, middleColRef }
}
