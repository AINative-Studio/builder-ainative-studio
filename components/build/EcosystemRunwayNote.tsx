'use client'

/**
 * Ecosystem runway note (#324 GR-15) — Cody's honest one-liner shown in the
 * workspace at the moment a build's primitive composition earns extra free
 * runway. The copy comes verbatim from the SERVER's credits response (the bonus
 * is server-computed and server-enforced); this component only surfaces it.
 * Renders nothing when no bonus was earned.
 */

import { useBuild } from '@/contexts/build-context'

export function EcosystemRunwayNote() {
  const { state } = useBuild()
  if (!state.runwayNote) return null
  return (
    <p className="m-cody-line m-runway-note" data-testid="ecosystem-runway-note">
      <span className="m-glyph">◇</span> {state.runwayNote}
    </p>
  )
}
