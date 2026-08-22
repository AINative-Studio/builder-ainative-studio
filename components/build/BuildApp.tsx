'use client'

/** Top-level pivot router (#220) — switches screens off the state machine. */

import { BuildProvider, useBuild } from '@/contexts/build-context'
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
  return (
    <BuildProvider>
      <ScreenRouter />
    </BuildProvider>
  )
}
