'use client'

/** Top-level pivot router (#220) — switches screens off the state machine. */

import { useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { BuildProvider, useBuild, isExplicitCompanyDeepLink } from '@/contexts/build-context'
import { captureAttribution } from '@/lib/build/attribution'
import { Landing } from '@/components/build/screens/Landing'
import { Start } from '@/components/build/screens/Start'
import { BuildStart } from '@/components/build/screens/BuildStart'
import { Fork } from '@/components/build/screens/Fork'
import { Intake } from '@/components/build/screens/Intake'
import { KickoffQuestions } from '@/components/build/screens/KickoffQuestions'
import { Workspace } from '@/components/build/screens/Workspace'
import { Pricing } from '@/components/build/screens/Pricing'
import { Live } from '@/components/build/screens/Live'
import { Auth } from '@/components/build/screens/Auth'
import { Account } from '@/components/build/screens/Account'
import { MyCompanies } from '@/components/build/screens/MyCompanies'
import { ReferEarn } from '@/components/build/screens/ReferEarn'

/**
 * #650: screens that require a real session — a guest session still counts
 * (isGuestSession callers treat it as "signed in, anonymously"), so the only
 * disqualifying state is next-auth's 'unauthenticated' (no session at all).
 */
export const PROTECTED_SCREENS = new Set(['account', 'companies'])

export function isProtectedScreenLocked(status: string, screen: string): boolean {
  return status === 'unauthenticated' && PROTECTED_SCREENS.has(screen)
}

/**
 * Should the Polsia-parity front door below route a signed-in founder to their
 * companies index? (builder#1037)
 *
 * The effect's own re-check at fetch-resolve time (`screenRef.current ===
 * 'landing'`) rested on the stated reasoning that "?screen= deep links win
 * (they move screen off 'landing' before this fetch resolves)". That has a real
 * hole: ScreenRouter is a CHILD of BuildProvider, and React runs child effects
 * BEFORE parent effects — so this effect fires, and can see its fetch resolve,
 * before the deep-link effect's dispatches are ever committed. At that moment
 * `screenRef.current` is still the reducer's initial 'landing' and the guard
 * waves the redirect through, bouncing a founder off the Live dashboard they
 * explicitly deep-linked to.
 *
 * Reproduced in a real browser, attributed by instrumenting this exact dispatch
 * (origin `['buildapp-mycompanies', 'landing']`). It is latency-dependent — a
 * fast/cached /api/build/my-companies hits the window; with the response
 * delayed past ~400ms the ref guard held — which is what made the bounce look
 * intermittent.
 *
 * The URL is checked alongside the ref because it is correct from the first
 * byte and no commit ordering can race it. Everything else is the effect's
 * pre-existing behavior, unchanged: only from the landing screen, and only for
 * a founder who really does have at least one company.
 */
export function shouldRouteToCompaniesIndex(input: {
  screen: string
  search: string
  data: { companies?: unknown } | null | undefined
}): boolean {
  if (input.screen !== 'landing') return false
  if (isExplicitCompanyDeepLink(input.search)) return false
  const companies = input.data?.companies
  return Array.isArray(companies) && companies.length > 0
}

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
        // Get started, Sign in), never yank them. #1037: the screen ref alone
        // cannot see a deep link that has not committed yet, so the URL is
        // consulted too — see shouldRouteToCompaniesIndex.
        if (shouldRouteToCompaniesIndex({
          screen: screenRef.current,
          search: window.location.search,
          data: d,
        })) {
          dispatch({ type: 'GOTO_SCREEN', screen: 'companies' })
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, state.screen])

  // #650: nothing previously bounced an unauthenticated visitor OFF a
  // protected screen — a stale client render (post sign-out redirect race,
  // or the back button after logout) could show Account/My Portfolio with
  // no real session behind it.
  useEffect(() => {
    if (isProtectedScreenLocked(status, state.screen)) {
      dispatch({ type: 'GOTO_SCREEN', screen: 'landing' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, state.screen])

  if (isProtectedScreenLocked(status, state.screen)) {
    return <Landing />
  }

  switch (state.screen) {
    case 'landing': return <Landing />
    case 'start': return <Start />
    case 'build': return <BuildStart />
    case 'fork': return <Fork />
    case 'intake': return <Intake />
    case 'kickoff': return <KickoffQuestions />
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
