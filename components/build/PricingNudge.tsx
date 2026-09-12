'use client'

/**
 * Pricing nudge (#653) — a thin strip shown while Cody is actively driving
 * the build (state.auto), stating that pricing is usage-based, not seat-
 * based. This is the single highest-leverage placement from the issue: the
 * founder is watching substantial visible work happen, so tying that work to
 * "this counts against usage, not headcount" lands harder than a generic
 * pricing line elsewhere.
 *
 * A THIN STRIP, not a panel — #652 gave the artifact rail its own fixed-width
 * side drawer, so there's no real estate collision; this renders full-width
 * in the workspace body, above the 3-column row.
 *
 * Shown at most MAX_SHOWN times total (per browser) — novel early, noise by
 * the fourth run, per the issue's own constraint.
 */

import { useEffect, useState } from 'react'
import { useBuild } from '@/contexts/build-context'
import { shouldShowPricingNudge, recordPricingNudgeShown, browserStorage } from '@/lib/build/pricing-nudge'

export function PricingNudge() {
  const { state } = useBuild()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!state.auto) { setVisible(false); return }
    const store = browserStorage()
    if (shouldShowPricingNudge(store)) {
      setVisible(true)
      recordPricingNudgeShown(store)
    }
    // Intentionally NOT re-running per artifact/render — only once per mount
    // of an active autoplay session (a re-render mid-build must not re-count
    // or flip visibility back on if the founder already dismissed it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.auto])

  if (!visible) return null

  return (
    <div className="m-pricing-nudge m-mono" data-testid="pricing-nudge" role="note">
      <span>
        Watching Cody work? Every plan includes all primitives — <strong>you're billed on usage, not seats</strong>. Add
        teammates for free.
      </span>
      <button
        className="m-pricing-nudge-dismiss"
        data-testid="pricing-nudge-dismiss"
        aria-label="Dismiss"
        onClick={() => setVisible(false)}
      >
        ✕
      </button>
    </div>
  )
}
