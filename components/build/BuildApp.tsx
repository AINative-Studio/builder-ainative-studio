'use client'

/** Top-level pivot router (#220) — switches screens off the state machine. */

import { useEffect } from 'react'
import { BuildProvider, useBuild } from '@/contexts/build-context'
import { captureAttribution } from '@/lib/build/attribution'
import { Fork } from '@/components/build/screens/Fork'
import { Intake } from '@/components/build/screens/Intake'
import { Workspace } from '@/components/build/screens/Workspace'
import { Pricing } from '@/components/build/screens/Pricing'
import { Live } from '@/components/build/screens/Live'
import { Auth } from '@/components/build/screens/Auth'
import { Account } from '@/components/build/screens/Account'
import { MyCompanies } from '@/components/build/screens/MyCompanies'

function ScreenRouter() {
  const { state } = useBuild()
  switch (state.screen) {
    case 'fork': return <Fork />
    case 'intake': return <Intake />
    case 'ws': return <Workspace />
    case 'pricing': return <Pricing />
    case 'live': return <Live />
    case 'login': case 'signup': case 'forgot': case 'reset': return <Auth mode={state.screen} />
    case 'account': return <Account />
    case 'companies': return <MyCompanies />
    default: return <Fork />
  }
}

export function BuildApp() {
  // Capture the ad-click gclid/fbclid + utm on landing (#207) as soon as the entry
  // page mounts, independent of provider/screen mount order. Idempotent (last ad
  // click wins, never clobbers a captured id), so double-firing with the copy in
  // BuildProvider is harmless — this is the guaranteed hook on the /build + homepage
  // entry points the ads land on.
  useEffect(() => {
    captureAttribution()
  }, [])

  return (
    <BuildProvider>
      <ScreenRouter />
    </BuildProvider>
  )
}
