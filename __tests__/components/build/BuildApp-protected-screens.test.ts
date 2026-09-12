import { describe, it, expect } from 'vitest'
import { isProtectedScreenLocked, PROTECTED_SCREENS } from '@/components/build/BuildApp'

/**
 * #650 — "Logout requires two clicks and lands on the wrong page."
 *
 * Root cause (confirmed live via Playwright): bare `signOut()` calls redirect
 * back to the CURRENT url (next-auth's default with no redirect callback),
 * which for this SPA is whatever ?screen= the user was on. Session teardown
 * itself was already correct (fetch('/api/auth/session') -> null after one
 * click) — the bug was purely "redirect to the wrong place" plus "nothing
 * guards a protected screen once the session really is gone" (e.g. the back
 * button after logout, confirmed live to land back on ?screen=companies with
 * cached authenticated-looking content).
 *
 * isProtectedScreenLocked is the pure guard extracted from BuildApp's
 * ScreenRouter so the decision is unit-testable without mounting the whole
 * provider tree.
 */
describe('isProtectedScreenLocked (#650)', () => {
  it('locks the account screen when there is no session at all', () => {
    expect(isProtectedScreenLocked('unauthenticated', 'account')).toBe(true)
  })

  it('locks the companies (My Portfolio) screen when there is no session at all', () => {
    expect(isProtectedScreenLocked('unauthenticated', 'companies')).toBe(true)
  })

  it('never locks a genuinely authenticated session', () => {
    expect(isProtectedScreenLocked('authenticated', 'account')).toBe(false)
    expect(isProtectedScreenLocked('authenticated', 'companies')).toBe(false)
  })

  it('never locks while the session is still loading (avoids a flash-redirect on refresh)', () => {
    expect(isProtectedScreenLocked('loading', 'account')).toBe(false)
    expect(isProtectedScreenLocked('loading', 'companies')).toBe(false)
  })

  it('a guest session (still "authenticated" in next-auth terms) is never locked out', () => {
    // Guest sessions are provisioned via the 'guest' credentials provider and
    // report status: 'authenticated' just like a real login — isGuestSession()
    // distinguishes them at the data layer, not at the routing layer.
    expect(isProtectedScreenLocked('authenticated', 'account')).toBe(false)
  })

  it('unprotected screens are never locked, even fully signed out', () => {
    for (const screen of ['landing', 'start', 'build', 'fork', 'intake', 'ws', 'pricing', 'live', 'login', 'signup', 'refer']) {
      expect(isProtectedScreenLocked('unauthenticated', screen)).toBe(false)
    }
  })

  it('PROTECTED_SCREENS is exactly the identity/portfolio screens, nothing broader', () => {
    expect(PROTECTED_SCREENS).toEqual(new Set(['account', 'companies']))
  })
})
