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
 * #1204 (Coverage Phase 4) — BuildApp.tsx's ScreenRouter (the top-level
 * switch off state.screen) and BuildApp() itself had zero render coverage.
 * isProtectedScreenLocked/shouldRouteToCompaniesIndex (the pure decisions)
 * are already tested directly (BuildApp-protected-screens.test.ts,
 * build-app-mycompanies-deeplink-1037.test.ts) — this file covers the
 * component wiring those decisions feed into: the real switch-statement
 * routing, the #650 protected-screen redirect dispatch, and BuildApp's own
 * BuildProvider + captureAttribution mount. Every screen component is
 * stubbed to a marker div so only ScreenRouter's OWN routing is under test,
 * not each screen's internals (each has its own dedicated test file).
 */

const h = vi.hoisted(() => ({ state: {} as Record<string, any>, dispatch: vi.fn(), sessionStatus: 'unauthenticated' as string }))

vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: h.state, dispatch: h.dispatch }),
  BuildProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  isExplicitCompanyDeepLink: (search: string) => new URLSearchParams(search).has('company'),
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: h.sessionStatus }) }))
vi.mock('@/lib/build/attribution', () => ({ captureAttribution: vi.fn() }))

function stubScreen(testId: string) {
  return () => React.createElement('div', { 'data-testid': testId })
}
vi.mock('@/components/build/screens/Landing', () => ({ Landing: stubScreen('screen-landing') }))
vi.mock('@/components/build/screens/Start', () => ({ Start: stubScreen('screen-start') }))
vi.mock('@/components/build/screens/BuildStart', () => ({ BuildStart: stubScreen('screen-build') }))
vi.mock('@/components/build/screens/Fork', () => ({ Fork: stubScreen('screen-fork') }))
vi.mock('@/components/build/screens/Intake', () => ({ Intake: stubScreen('screen-intake') }))
vi.mock('@/components/build/screens/KickoffQuestions', () => ({ KickoffQuestions: stubScreen('screen-kickoff') }))
vi.mock('@/components/build/screens/Workspace', () => ({ Workspace: stubScreen('screen-ws') }))
vi.mock('@/components/build/screens/Pricing', () => ({ Pricing: stubScreen('screen-pricing') }))
vi.mock('@/components/build/screens/Live', () => ({ Live: stubScreen('screen-live') }))
vi.mock('@/components/build/screens/Auth', () => ({ Auth: ({ mode }: { mode: string }) => React.createElement('div', { 'data-testid': 'screen-auth', 'data-mode': mode }) }))
vi.mock('@/components/build/screens/Account', () => ({ Account: stubScreen('screen-account') }))
vi.mock('@/components/build/screens/MyCompanies', () => ({ MyCompanies: stubScreen('screen-companies') }))
vi.mock('@/components/build/screens/ReferEarn', () => ({ ReferEarn: stubScreen('screen-refer') }))

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
  vi.restoreAllMocks()
  h.dispatch.mockClear()
  h.sessionStatus = 'unauthenticated'
})

async function importBuildApp() {
  const mod = await import('@/components/build/BuildApp')
  return mod.BuildApp
}

describe('BuildApp — ScreenRouter switch (#1204)', () => {
  const cases: Array<[string, string]> = [
    ['landing', 'screen-landing'],
    ['start', 'screen-start'],
    ['build', 'screen-build'],
    ['fork', 'screen-fork'],
    ['intake', 'screen-intake'],
    ['kickoff', 'screen-kickoff'],
    ['ws', 'screen-ws'],
    ['pricing', 'screen-pricing'],
    ['live', 'screen-live'],
    ['account', 'screen-account'],
    ['companies', 'screen-companies'],
    ['refer', 'screen-refer'],
    ['nonsense-unknown-screen', 'screen-landing'], // default branch
  ]

  for (const [screen, expectedTestId] of cases) {
    it(`routes state.screen=${screen} to ${expectedTestId}`, async () => {
      h.sessionStatus = 'authenticated' // bypass the #650 protected-screen gate for this matrix
      h.state = { screen }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ companies: [] }) }))

      const BuildApp = await importBuildApp()
      render(React.createElement(BuildApp))
      await flush()

      expect(host.querySelector(`[data-testid="${expectedTestId}"]`)).not.toBeNull()
    })
  }

  for (const mode of ['login', 'signup', 'forgot', 'reset']) {
    it(`routes state.screen=${mode} to the Auth screen with mode=${mode}`, async () => {
      h.sessionStatus = 'authenticated'
      h.state = { screen: mode }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ companies: [] }) }))

      const BuildApp = await importBuildApp()
      render(React.createElement(BuildApp))
      await flush()

      const el = host.querySelector('[data-testid="screen-auth"]')
      expect(el).not.toBeNull()
      expect(el?.getAttribute('data-mode')).toBe(mode)
    })
  }
})

describe('BuildApp — #650 protected-screen redirect', () => {
  it('an unauthenticated visitor on "account" is shown Landing, not the protected screen, and GOTO_SCREEN landing is dispatched', async () => {
    h.sessionStatus = 'unauthenticated'
    h.state = { screen: 'account' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ companies: [] }) }))

    const BuildApp = await importBuildApp()
    render(React.createElement(BuildApp))
    await flush()

    expect(host.querySelector('[data-testid="screen-landing"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="screen-account"]')).toBeNull()
    expect(h.dispatch).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'landing' })
  })

  it('an authenticated founder on "account" sees the real Account screen, no redirect dispatched', async () => {
    h.sessionStatus = 'authenticated'
    h.state = { screen: 'account' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ companies: [] }) }))

    const BuildApp = await importBuildApp()
    render(React.createElement(BuildApp))
    await flush()

    expect(host.querySelector('[data-testid="screen-account"]')).not.toBeNull()
    expect(h.dispatch).not.toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'landing' })
  })

  it('an unauthenticated visitor on an unprotected screen (landing) is left alone, no redirect', async () => {
    h.sessionStatus = 'unauthenticated'
    h.state = { screen: 'landing' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ companies: [] }) }))

    const BuildApp = await importBuildApp()
    render(React.createElement(BuildApp))
    await flush()

    expect(host.querySelector('[data-testid="screen-landing"]')).not.toBeNull()
    expect(h.dispatch).not.toHaveBeenCalled()
  })
})

describe('BuildApp — #1037 my-companies front-door redirect', () => {
  it('a signed-in founder landing with real companies is routed to the companies index', async () => {
    h.sessionStatus = 'authenticated'
    h.state = { screen: 'landing' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ companies: [{ id: 'co-1' }] }) }))
    Object.defineProperty(window, 'location', { value: { ...window.location, search: '' }, writable: true })

    const BuildApp = await importBuildApp()
    render(React.createElement(BuildApp))
    await flush()
    await flush()

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'companies' })
  })

  it('a signed-in founder with NO companies stays on landing (new-user path), no redirect', async () => {
    h.sessionStatus = 'authenticated'
    h.state = { screen: 'landing' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ companies: [] }) }))

    const BuildApp = await importBuildApp()
    render(React.createElement(BuildApp))
    await flush()
    await flush()

    expect(h.dispatch).not.toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'companies' })
  })
})
