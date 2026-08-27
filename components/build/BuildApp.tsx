'use client'

/** Top-level pivot router (#220) — switches screens off the state machine. */

import { useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { BuildProvider, useBuild } from '@/contexts/build-context'
import { captureAttribution } from '@/lib/build/attribution'
import { Landing } from '@/components/build/screens/Landing'
import { Start } from '@/components/build/screens/Start'
import { BuildStart } from '@/components/build/screens/BuildStart'
import { Fork } from '@/components/build/screens/Fork'
import { Intake } from '@/components/build/screens/Intake'
import { Workspace } from '@/components/build/screens/Workspace'
import { Pricing } from '@/components/build/screens/Pricing'
import { Live } from '@/components/build/screens/Live'
import { Auth } from '@/components/build/screens/Auth'
import { Account } from '@/components/build/screens/Account'
import { MyCompanies } from '@/components/build/screens/MyCompanies'
import { ReferEarn } from '@/components/build/screens/ReferEarn'

function ScreenRouter() {
  const { state, dispatch } = useBuild()
  const { status } = useSession()
  const checkedProjects = useRef(false)

  // Polsia-parity front door (founder direction 2026-08-27):
  //   - Logged out / brand-new → the marketing landing + funnel.
  //   - Signed in WITH builder projects → their project dashboard loads (My
  //     Builds), like Polsia landing on /dashboard/{company}.
  //   - Signed in with NO projects → stays on the landing/funnel (new-user path).
  // One-shot on initial load, and ONLY from the landing — a founder who
  // deliberately navigates into the funnel ("+ New company", Get started) is
  // never yanked out of it. ?screen= deep links win (they move screen off
  // 'landing' before this fetch resolves).
  const screenRef = useRef(state.screen)
  screenRef.current = state.screen
  useEffect(() => {
    if (status !== 'authenticated' || checkedProjects.current) return
    if (state.screen !== 'landing') { checkedProjects.current = true; return }
    checkedProjects.current = true
    fetch('/api/build/my-companies')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        // Re-check at resolve time: if the founder already navigated (deep link,
        // Get started, Sign in), never yank them.
        if (
          screenRef.current === 'landing' &&
          Array.isArray(d?.companies) && d.companies.length > 0
        ) {
          dispatch({ type: 'GOTO_SCREEN', screen: 'companies' })
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, state.screen])

  switch (state.screen) {
    case 'landing': return <Landing />
    case 'start': return <Start />
    case 'build': return <BuildStart />
    case 'fork': return <Fork />
    case 'intake': return <Intake />
    case 'ws': return <Workspace />
    case 'pricing': return <Pricing />
    case 'live': return <Live />
    case 'login': case 'signup': case 'forgot': case 'reset': return <Auth mode={state.screen} />
    case 'account': return <Account />
    case 'companies': return <MyCompanies />
    case 'refer': return <ReferEarn />
    default: return <Landing />
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
