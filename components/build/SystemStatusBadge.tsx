'use client'

/**
 * SystemStatusBadge (#67) — Live vs Planned/Simulated.
 *
 * Renders a Modernist `.st` status pill using existing modernist.css classes:
 *   .st.is-done    → green check  → Live
 *   .st.is-running → pulsing dot  → Planned
 *
 * Keep this component focused: badge only. Caller decides placement and spacing.
 */

import { systemBadge } from '@/lib/build/live-vs-planned'

interface SystemStatusBadgeProps {
  /** Is this system backed by a real provisioned data source? */
  provisioned?: boolean
  /** If set, the system has a real instance URL (overrides provisioned flag). */
  url?: string
  /** Optional extra className added to the .st pill */
  className?: string
}

export function SystemStatusBadge({ provisioned, url, className = '' }: SystemStatusBadgeProps) {
  const badge = systemBadge({ provisioned, url })
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
