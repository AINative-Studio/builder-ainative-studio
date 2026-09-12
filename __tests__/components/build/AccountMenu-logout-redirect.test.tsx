// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #650 — bare `signOut()` redirects back to the CURRENT url (next-auth's
 * default with no redirect callback configured in app/(auth)/auth.config.ts),
 * which for the /build SPA is whatever ?screen= the user was on. Confirmed
 * live via Playwright: after clicking "Sign out" from ?screen=account, the
 * URL stayed at ?screen=account with a torn-down session, and back-button
 * afterward returned to ?screen=companies. Fix: every signOut() call site in
 * the Build app now passes an explicit callbackUrl to the public landing
 * screen, matching the already-correct pattern in components/user-nav.tsx.
 */

const signOutMock = vi.fn()
vi.mock('next-auth/react', () => ({
  signOut: (...args: any[]) => signOutMock(...args),
}))
vi.mock('@/lib/build/account-session', () => ({
  isGuestSession: () => false,
  getDisplayName: () => 'Toby',
  getDisplayEmail: () => 'toby@ainative.studio',
}))

import { AccountMenu } from '@/components/build/AccountMenu'

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
})

describe('AccountMenu logout (#650)', () => {
  it('clicking Sign out passes an explicit callbackUrl to the public landing screen, not a bare redirect', () => {
    render(
      React.createElement(AccountMenu, {
        session: { user: { name: 'Toby', email: 'toby@ainative.studio' } } as any,
        open: true,
        onOpenChange: vi.fn(),
        onScreen: vi.fn(),
      }),
    )

    const items = Array.from(host.querySelectorAll('button, a'))
    const logoutItem = items.find((el) => el.textContent?.match(/log ?out|sign ?out/i))
    expect(logoutItem).toBeTruthy()

    act(() => { (logoutItem as HTMLElement).click() })

    expect(signOutMock).toHaveBeenCalledTimes(1)
    expect(signOutMock).toHaveBeenCalledWith(
      expect.objectContaining({ callbackUrl: '/build?screen=landing', redirect: true }),
    )
  })
})
