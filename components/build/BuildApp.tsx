'use client'

/** Top-level pivot router (#220) — switches screens off the state machine. */

import { BuildProvider, useBuild } from '@/contexts/build-context'
import { Fork } from '@/components/build/screens/Fork'
import { Intake } from '@/components/build/screens/Intake'
import { Workspace } from '@/components/build/screens/Workspace'

function ScreenRouter() {
  const { state } = useBuild()
  switch (state.screen) {
    case 'fork': return <Fork />
    case 'intake': return <Intake />
    case 'ws': return <Workspace />
    // pricing / live / auth / account land in #226 / #227
    default: return <Fork />
  }
}

export function BuildApp() {
  return (
    <BuildProvider>
      <ScreenRouter />
    </BuildProvider>
  )
}
