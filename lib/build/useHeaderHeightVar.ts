'use client'

/**
 * Measures the REAL, dynamic height of a page-chrome element and writes it
 * to a CSS custom property on a target container (#754).
 *
 * Why this exists: the Live dashboard's chat rail (`.m-live-col-chat`) is
 * `position: sticky` with `top`/`height` computed against the viewport. That
 * only works correctly when nothing but a small, constant offset sits above
 * the sticky grid. In reality the masthead + funnel/provisioning banner (4
 * real states: paid/trial/provisioning/anonymous, #748) + product card +
 * hero metrics row sit above the grid, and the banner's height genuinely
 * varies by account state. A hardcoded `calc(100vh - 24px)` (the #484 fix)
 * assumes ~24px of chrome when the real figure is several hundred px and
 * state-dependent — this is issue #754, the SECOND time a fixed-constant
 * "fix" here has broken. Rather than guess a new constant, this hook
 * measures the header ref's actual rendered height at runtime (initial
 * layout + every resize, via ResizeObserver) and exposes it as a CSS custom
 * property, so any constant swapped into the banner/masthead/metrics never
 * desyncs the sticky math again.
 *
 * Usage: attach `headerRef` to the wrapper spanning everything that sits
 * above the sticky grid, and `containerRef` to the sticky grid's own
 * ancestor (or any element the sticky column inherits custom properties
 * from) — CSS then reads `var(--live-header-h)` instead of a literal.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react'

export const LIVE_HEADER_HEIGHT_VAR = '--live-header-h'

export function useHeaderHeightVar<
  H extends HTMLElement = HTMLDivElement,
  C extends HTMLElement = HTMLDivElement,
>(varName: string = LIVE_HEADER_HEIGHT_VAR): {
  headerRef: RefObject<H | null>
  containerRef: RefObject<C | null>
} {
  const headerRef = useRef<H | null>(null)
  const containerRef = useRef<C | null>(null)

  useLayoutEffect(() => {
    const headerEl = headerRef.current
    const containerEl = containerRef.current ?? headerEl
    if (!headerEl || !containerEl) return

    const apply = () => {
      // getBoundingClientRect (not offsetHeight) so this stays correct under
      // any transform/zoom, and rounds to whole px to avoid subpixel jitter
      // re-triggering layout on every observer tick.
      const h = Math.ceil(headerEl.getBoundingClientRect().height)
      containerEl.style.setProperty(varName, `${h}px`)
    }

    apply()

    // Real header height is dynamic: banner state changes (paid/trial/
    // provisioning/anonymous, #748), async content (visitor count, RLHF
    // pulse) mounting in, and viewport width changes all resize it after
    // first paint — ResizeObserver (not a one-shot measurement) is what
    // keeps `--live-header-h` truthful as any of that shifts.
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(apply)
    ro.observe(headerEl)
    return () => ro.disconnect()
  }, [varName])

  return { headerRef, containerRef }
}
