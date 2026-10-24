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
 * #1204 (Coverage Phase 4) — AppHeader (components/shared/app-header.tsx,
 * 234 lines) had zero test coverage despite rendering on nearly every real
 * page (/insights, /settings/*, /admin/*, /chats, /templates/[slug], etc).
 * ChatSelector already has its own dedicated coverage this pass — mocked
 * here along with WorkspaceSwitcher/UserNavClient/MobileMenu at their real
 * exported boundaries, so this file verifies only AppHeader's own
 * session-gated nav, homepage logo-reset behavior, the search-params
 * session-refresh handler, and the Info dialog.
 */

let sessionData: { user: { email: string } } | null = null
const sessionUpdate = vi.fn()
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: sessionData, update: sessionUpdate }) }))

let pathname = '/'
let searchParamsStr = ''
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(searchParamsStr),
}))

vi.mock('@/components/shared/chat-selector', () => ({ ChatSelector: () => React.createElement('div', { 'data-testid': 'stub-chat-selector' }) }))
vi.mock('@/components/shared/mobile-menu', () => ({ MobileMenu: ({ onInfoDialogOpen }: any) => React.createElement('button', { type: 'button', 'data-testid': 'stub-mobile-menu', onClick: onInfoDialogOpen }, 'Menu') }))
vi.mock('@/components/user-nav-client', () => ({ UserNavClient: ({ session }: any) => React.createElement('div', { 'data-testid': 'stub-user-nav' }, session ? 'signed-in' : 'signed-out') }))
vi.mock('@/components/workspace-switcher', () => ({ WorkspaceSwitcher: () => React.createElement('div', { 'data-testid': 'stub-workspace-switcher' }) }))

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  sessionData = null
  pathname = '/'
  searchParamsStr = ''
  vi.clearAllMocks()
})

describe('AppHeader — real session-gated nav + logo/search-params/dialog coverage (#1204)', () => {
  it('never shows "My Builds", "Templates", or "Deployments" for an anonymous visitor', async () => {
    const { AppHeader } = await import('@/components/shared/app-header')
    render(React.createElement(AppHeader))
    await flush()

    expect(host.querySelector('[data-testid="nav-my-builds"]')).toBeNull()
    expect(Array.from(host.querySelectorAll('a')).some((a) => a.textContent?.includes('Templates'))).toBe(false)
    expect(Array.from(host.querySelectorAll('a')).some((a) => a.textContent?.includes('Deployments'))).toBe(false)
  })

  it('shows "My Builds", "Templates", and "Deployments" for a genuinely signed-in session', async () => {
    sessionData = { user: { email: 'a@b.com' } }
    const { AppHeader } = await import('@/components/shared/app-header')
    render(React.createElement(AppHeader))
    await flush()

    expect(host.querySelector('[data-testid="nav-my-builds"]')).not.toBeNull()
    expect(Array.from(host.querySelectorAll('a')).some((a) => a.textContent?.includes('Templates'))).toBe(true)
    expect(Array.from(host.querySelectorAll('a')).some((a) => a.textContent?.includes('Deployments'))).toBe(true)
  })

  it('always shows the real public SEO links (Guides/About/Help/Pricing) regardless of session', async () => {
    const { AppHeader } = await import('@/components/shared/app-header')
    render(React.createElement(AppHeader))
    await flush()

    const linkTexts = Array.from(host.querySelectorAll('a')).map((a) => a.textContent)
    expect(linkTexts.some((t) => t?.includes('Guides'))).toBe(true)
    expect(linkTexts.some((t) => t?.includes('About'))).toBe(true)
    expect(linkTexts.some((t) => t?.includes('Help'))).toBe(true)
    expect(linkTexts.some((t) => t?.includes('Pricing'))).toBe(true)
  })

  it('adds the real border-b class only on a non-homepage pathname', async () => {
    pathname = '/settings/rules'
    const { AppHeader } = await import('@/components/shared/app-header')
    render(React.createElement(AppHeader))
    await flush()

    expect(host.querySelector('header')?.className).toContain('border-b')
  })

  it('never adds the border class on the real homepage pathname', async () => {
    pathname = '/'
    const { AppHeader } = await import('@/components/shared/app-header')
    render(React.createElement(AppHeader))
    await flush()

    expect(host.querySelector('header')?.className).not.toContain('border-b')
  })

  it('a real logo click on the homepage prevents default navigation and sets window.location.href to the real reset URL', async () => {
    pathname = '/'
    const originalLocation = window.location
    const fakeLocation = { ...originalLocation, href: '' }
    Object.defineProperty(window, 'location', { value: fakeLocation, writable: true, configurable: true })

    const { AppHeader } = await import('@/components/shared/app-header')
    render(React.createElement(AppHeader))
    await flush()

    const logoLink = host.querySelector('a[href="/"]') as HTMLAnchorElement
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
    await act(async () => { logoLink.dispatchEvent(event) })

    expect(preventDefaultSpy).toHaveBeenCalled()
    expect(window.location.href).toBe('/?reset=true')

    Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true })
  })

  it('a real logo click when NOT on the homepage never calls preventDefault (lets real Link navigation proceed)', async () => {
    pathname = '/settings/rules'
    const { AppHeader } = await import('@/components/shared/app-header')
    render(React.createElement(AppHeader))
    await flush()

    const logoLink = host.querySelector('a[href="/"]') as HTMLAnchorElement
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
    await act(async () => { logoLink.dispatchEvent(event) })

    expect(preventDefaultSpy).not.toHaveBeenCalled()
  })

  it('a real ?refresh=session search param calls the real session update() and strips the param from the URL', async () => {
    searchParamsStr = 'refresh=session'
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState')
    const { AppHeader } = await import('@/components/shared/app-header')
    render(React.createElement(AppHeader))
    await flush()

    expect(sessionUpdate).toHaveBeenCalled()
    expect(replaceStateSpy).toHaveBeenCalled()
  })

  it('never calls session update() when there is genuinely no refresh search param', async () => {
    searchParamsStr = ''
    const { AppHeader } = await import('@/components/shared/app-header')
    render(React.createElement(AppHeader))
    await flush()

    expect(sessionUpdate).not.toHaveBeenCalled()
  })

  it('the real mobile menu\'s onInfoDialogOpen opens the real Info dialog with real AINative platform copy', async () => {
    const { AppHeader } = await import('@/components/shared/app-header')
    render(React.createElement(AppHeader))
    await flush()

    expect(document.body.textContent).not.toContain('AI-powered UI generation platform')

    const mobileMenuBtn = host.querySelector('[data-testid="stub-mobile-menu"]') as HTMLButtonElement
    await act(async () => { mobileMenuBtn.click() })

    expect(document.body.textContent).toContain('AI-powered UI generation platform')

    const tryNowBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === 'Try now') as HTMLButtonElement
    await act(async () => { tryNowBtn.click() })

    expect(document.body.textContent).not.toContain('AI-powered UI generation platform')
  })
})
