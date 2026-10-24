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
 * #1204 (Coverage Phase 4) — MobileMenu (components/shared/mobile-menu.tsx,
 * 216 lines, reached live via components/shared/app-header.tsx) had zero
 * test coverage. ChatSelector already has its own dedicated coverage this
 * pass — mocked here at its real exported boundary.
 *
 * Real finding (confirmed by reading the full source, filed as issue #1365
 * rather than fixed inline): the `onInfoDialogOpen` prop is destructured but
 * genuinely never called anywhere in this component — AppHeader's Info
 * dialog is unreachable from mobile. Tests below assert this real (if
 * surprising) behavior, not the originally-assumed wiring.
 */

let sessionData: { user: { id: string } } | null = null
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: sessionData }) }))

let pathname = '/'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

vi.mock('@/components/shared/chat-selector', () => ({ ChatSelector: () => React.createElement('div', { 'data-testid': 'stub-chat-selector' }) }))

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function openMenuBtn(): HTMLButtonElement {
  return Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Open menu')) as HTMLButtonElement
}

function closeMenuBtn(): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Close menu')) as HTMLButtonElement | undefined
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  document.body.innerHTML = ''
  document.body.style.overflow = ''
  sessionData = null
  pathname = '/'
  vi.useRealTimers()
})

describe('MobileMenu — real open/close/escape/session-gating coverage (#1204)', () => {
  it('renders genuinely closed by default (no overlay in the DOM)', async () => {
    const { MobileMenu } = await import('@/components/shared/mobile-menu')
    render(React.createElement(MobileMenu, { onInfoDialogOpen: vi.fn() }))
    expect(document.body.querySelector('.fixed.inset-0.z-50')).toBeNull()
  })

  it('a real menu-button click opens the real overlay and locks real body scroll', async () => {
    const { MobileMenu } = await import('@/components/shared/mobile-menu')
    render(React.createElement(MobileMenu, { onInfoDialogOpen: vi.fn() }))

    await act(async () => { openMenuBtn().click() })

    expect(document.body.querySelector('.fixed.inset-0.z-50')).not.toBeNull()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('a real close-button click starts the real close animation then removes the overlay after the real 300ms timeout, restoring scroll', async () => {
    vi.useFakeTimers()
    const { MobileMenu } = await import('@/components/shared/mobile-menu')
    render(React.createElement(MobileMenu, { onInfoDialogOpen: vi.fn() }))

    await act(async () => { openMenuBtn().click() })
    await act(async () => { closeMenuBtn()!.click() })

    // Still mounted immediately after close is requested (animating out).
    expect(document.body.querySelector('.fixed.inset-0.z-50')).not.toBeNull()

    await act(async () => { vi.advanceTimersByTime(300) })

    expect(document.body.querySelector('.fixed.inset-0.z-50')).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })

  it('a real backdrop click also closes the real menu', async () => {
    vi.useFakeTimers()
    const { MobileMenu } = await import('@/components/shared/mobile-menu')
    render(React.createElement(MobileMenu, { onInfoDialogOpen: vi.fn() }))

    await act(async () => { openMenuBtn().click() })
    const backdrop = document.body.querySelector('.bg-black\\/50') as HTMLElement
    await act(async () => { backdrop.click() })
    await act(async () => { vi.advanceTimersByTime(300) })

    expect(document.body.querySelector('.fixed.inset-0.z-50')).toBeNull()
  })

  it('a real Escape keydown closes the real open menu', async () => {
    vi.useFakeTimers()
    const { MobileMenu } = await import('@/components/shared/mobile-menu')
    render(React.createElement(MobileMenu, { onInfoDialogOpen: vi.fn() }))

    await act(async () => { openMenuBtn().click() })
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await act(async () => { vi.advanceTimersByTime(300) })

    expect(document.body.querySelector('.fixed.inset-0.z-50')).toBeNull()
  })

  it('a real Escape keydown while genuinely closed never throws and never opens the menu', async () => {
    const { MobileMenu } = await import('@/components/shared/mobile-menu')
    render(React.createElement(MobileMenu, { onInfoDialogOpen: vi.fn() }))

    expect(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }).not.toThrow()
    expect(document.body.querySelector('.fixed.inset-0.z-50')).toBeNull()
  })

  it('never shows "Your Chats" or "My Builds" for an anonymous visitor', async () => {
    sessionData = null
    const { MobileMenu } = await import('@/components/shared/mobile-menu')
    render(React.createElement(MobileMenu, { onInfoDialogOpen: vi.fn() }))
    await act(async () => { openMenuBtn().click() })

    expect(document.body.textContent).not.toContain('Your Chats')
    expect(document.body.querySelector('[data-testid="mobile-nav-my-builds"]')).toBeNull()
  })

  it('shows "Your Chats" (with the real ChatSelector) and "My Builds" for a genuinely signed-in user', async () => {
    sessionData = { user: { id: 'u1' } }
    const { MobileMenu } = await import('@/components/shared/mobile-menu')
    render(React.createElement(MobileMenu, { onInfoDialogOpen: vi.fn() }))
    await act(async () => { openMenuBtn().click() })

    expect(document.body.textContent).toContain('Your Chats')
    expect(document.body.querySelector('[data-testid="stub-chat-selector"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="mobile-nav-my-builds"]')).not.toBeNull()
  })

  it('always shows the real Templates/About/Deploy-to-Railway links regardless of session', async () => {
    const { MobileMenu } = await import('@/components/shared/mobile-menu')
    render(React.createElement(MobileMenu, { onInfoDialogOpen: vi.fn() }))
    await act(async () => { openMenuBtn().click() })

    const linkTexts = Array.from(document.body.querySelectorAll('a')).map((a) => a.textContent)
    expect(linkTexts.some((t) => t?.includes('Templates'))).toBe(true)
    expect(linkTexts.some((t) => t?.includes('About'))).toBe(true)
    expect(linkTexts.some((t) => t?.includes('Deploy to Railway'))).toBe(true)
  })

  it('real finding: onInfoDialogOpen is genuinely never called by this component, even with a full real interaction pass (filed as #1365, not fixed inline)', async () => {
    vi.useFakeTimers()
    const onInfoDialogOpen = vi.fn()
    sessionData = { user: { id: 'u1' } }
    const { MobileMenu } = await import('@/components/shared/mobile-menu')
    render(React.createElement(MobileMenu, { onInfoDialogOpen }))

    await act(async () => { openMenuBtn().click() })
    const links = Array.from(document.body.querySelectorAll('a, button'))
    for (const el of links) {
      await act(async () => { (el as HTMLElement).click() })
    }
    await act(async () => { vi.advanceTimersByTime(300) })

    expect(onInfoDialogOpen).not.toHaveBeenCalled()
  })
})
