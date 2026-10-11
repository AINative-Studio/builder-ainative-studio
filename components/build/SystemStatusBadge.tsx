'use client'

/**
 * SystemStatusBadge (#67, #1056) — Live vs Connected-not-wired vs Planned/Simulated.
 *
 * Renders a Modernist `.st` status pill using existing modernist.css classes:
 *   .st.is-done    → green check     → Live
 *   .st.is-needs   → amber square    → Connected, not wired (#1056)
 *   .st.is-running → pulsing dot     → Planned
 *
 * `wired` (#1056) is a real, honest signal distinct from `provisioned`:
 * `provisioned` means a credential was issued; `wired` means the generated
 * app's own source genuinely calls this primitive (lib/build/primitive-wiring).
 * Omitting `wired` (no scan result yet) never downgrades an existing Live
 * badge — see deriveSystemStatus's own doc comment for why `undefined` is
 * treated differently from an explicit `false`.
 *
 * Keep this component focused: badge only. Caller decides placement and spacing.
 */

import { systemBadge } from '@/lib/build/live-vs-planned'

interface SystemStatusBadgeProps {
  /** Is this system backed by a real provisioned data source? */
  provisioned?: boolean
  /** If set, the system has a real instance URL (overrides provisioned flag). */
  url?: string
  /** True/false when a wiring scan (#1056) found whether the app's code
   *  genuinely calls this primitive; undefined when no scan has run yet. */
  wired?: boolean
  /** Optional extra className added to the .st pill */
  className?: string
}

export function SystemStatusBadge({ provisioned, url, wired, className = '' }: SystemStatusBadgeProps) {
  const badge = systemBadge({ provisioned, url, wired })
  return (
    <span
      className={`st ${badge.modifier} ${className}`.trim()}
      data-testid="system-status-badge"
      data-status={badge.status}
      title={badge.description}
      aria-label={badge.description}
    >
      {badge.label}
    </span>
  )
}
