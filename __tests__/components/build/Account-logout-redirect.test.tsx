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
 * #650 — same fix as AccountMenu-logout-redirect.test.tsx, applied to the
 * Account screen's own two sign-out affordances ("Sign out" in the header,
 * "Sign out all" in the security section). Both were bare signOut() calls
 * that redirect back to the CURRENT url by next-auth default — confirmed
 * live to strand the user on ?screen=account post-logout instead of the
 * public landing page.
 */

const signOutMock = vi.fn()
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'Toby', email: 'toby@ainative.studio' } } }),
  signOut: (...args: any[]) => signOutMock(...args),
}))
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: { activePlan: 'pro', appSub: 'ember-box', companyName: 'Ember Box', track: 'company' }, dispatch: vi.fn() }),
}))
vi.mock('@/lib/build/account-session', () => ({
  isGuestSession: () => false,
  getDisplayName: () => 'Toby',
  getDisplayEmail: () => 'toby@ainative.studio',
}))
vi.mock('@/components/build/SettingsForm', () => ({ SettingsForm: () => null }))
vi.mock('@/components/build/DangerZone', () => ({ DangerZone: () => null }))

import { Account } from '@/components/build/screens/Account'

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function flush() {
  return act(async () => { await Promise.resolve(); await Promise.resolve() })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
})

describe('Account screen logout (#650)', () => {
  it('the header "Sign out" button redirects to the public landing screen, not the current url', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any
    render(React.createElement(Account))
    await flush()

    const btn = host.querySelector('[data-testid="account-sign-out"]') as HTMLButtonElement
    expect(btn).toBeTruthy()
    act(() => { btn.click() })

    expect(signOutMock).toHaveBeenCalledWith(
      expect.objectContaining({ callbackUrl: '/build?screen=landing', redirect: true }),
    )
  })

  it('"Sign out all" also redirects to the public landing screen', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any
    render(React.createElement(Account))
    await flush()

    const btn = host.querySelector('[data-testid="account-sign-out-all"]') as HTMLButtonElement
    expect(btn).toBeTruthy()
    act(() => { btn.click() })

    expect(signOutMock).toHaveBeenCalledWith(
      expect.objectContaining({ callbackUrl: '/build?screen=landing', redirect: true }),
    )
  })
})
