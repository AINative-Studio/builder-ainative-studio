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
 * #1204 (Coverage Phase 4) — PublicNav (components/shared/public-nav.tsx, 70
 * lines, reached live via 14+ real public pages — app/about, app/pricing,
 * app/compare, app/guides, app/help, app/evidence, app/templates,
 * app/showcase, app/capabilities, app/terms, app/privacy,
 * app/ai-company, app/ai-cofounder, app/autonomous-company-builder) had
 * zero test coverage.
 */

const h = vi.hoisted(() => ({ useSessionMock: vi.fn() }))
vi.mock('next-auth/react', () => ({ useSession: h.useSessionMock }))

import { PublicNav, type PublicNavLink } from '@/components/shared/public-nav'

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

describe('PublicNav — real default-links/auth-gated-CTA coverage (#1204)', () => {
  it('renders the real default link set (Guides/About/Evidence/Help/Pricing) when no links prop is given', () => {
    h.useSessionMock.mockReturnValue({ status: 'unauthenticated' })
    render(React.createElement(PublicNav))

    const links = Array.from(host.querySelectorAll('.m-land-nav-actions a')).map((a) => a.textContent)
    expect(links).toEqual(['Guides', 'About', 'Evidence', 'Help', 'Pricing', 'Sign in'])
  })

  it('renders every real link with its real href', () => {
    h.useSessionMock.mockReturnValue({ status: 'unauthenticated' })
    render(React.createElement(PublicNav))

    const hrefs = Array.from(host.querySelectorAll('.m-land-nav-actions a')).map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/guides', '/about', '/evidence', '/help', '/pricing', '/build?screen=login'])
  })

  it('renders a real custom links prop instead of the defaults when genuinely given', () => {
    h.useSessionMock.mockReturnValue({ status: 'unauthenticated' })
    const customLinks: PublicNavLink[] = [{ href: '/custom-one', label: 'Custom One' }]
    render(React.createElement(PublicNav, { links: customLinks }))

    const links = Array.from(host.querySelectorAll('.m-land-nav-actions a')).map((a) => a.textContent)
    expect(links).toEqual(['Custom One', 'Sign in'])
  })

  it('shows the real "Sign in" CTA pointed at /build?screen=login when genuinely signed out', () => {
    h.useSessionMock.mockReturnValue({ status: 'unauthenticated' })
    render(React.createElement(PublicNav))

    const signInLink = host.querySelector('[data-testid="public-nav-signin"]') as HTMLAnchorElement
    expect(signInLink.textContent).toBe('Sign in')
    expect(signInLink.getAttribute('href')).toBe('/build?screen=login')
    expect(host.querySelector('[data-testid="public-nav-open-builder"]')).toBeNull()
  })

  it('shows the real "Open Builder" CTA pointed at /build?screen=companies when genuinely authenticated', () => {
    h.useSessionMock.mockReturnValue({ status: 'authenticated' })
    render(React.createElement(PublicNav))

    const openBuilderLink = host.querySelector('[data-testid="public-nav-open-builder"]') as HTMLAnchorElement
    expect(openBuilderLink.textContent).toBe('Open Builder →')
    expect(openBuilderLink.getAttribute('href')).toBe('/build?screen=companies')
    expect(host.querySelector('[data-testid="public-nav-signin"]')).toBeNull()
  })

  it('never shows the Open Builder CTA while session status is genuinely "loading"', () => {
    h.useSessionMock.mockReturnValue({ status: 'loading' })
    render(React.createElement(PublicNav))

    expect(host.querySelector('[data-testid="public-nav-open-builder"]')).toBeNull()
    expect(host.querySelector('[data-testid="public-nav-signin"]')).not.toBeNull()
  })

  it('renders the real brand link pointing home, with the real "by AINative" byline', () => {
    h.useSessionMock.mockReturnValue({ status: 'unauthenticated' })
    render(React.createElement(PublicNav))

    const brandLink = host.querySelector('.m-land-brand') as HTMLAnchorElement
    expect(brandLink.getAttribute('href')).toBe('/')
    expect(brandLink.textContent).toContain('BUILDER')
    expect(brandLink.textContent).toContain('by AINative')
  })
})
