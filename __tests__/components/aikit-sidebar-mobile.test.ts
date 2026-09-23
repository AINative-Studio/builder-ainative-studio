// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

/**
 * AIKitSidebar mobile responsiveness (real, live bug fix — a real
 * customer's generated app, agentive-product, had AIKitSidebar rendering
 * full-width and permanently visible on a 390px phone viewport, with the
 * rest of the app's content pushed off-screen and no way to reach it).
 *
 * AIKitSidebar is the MANDATED sidebar pattern for every generated
 * dashboard (professional-prompt.ts: "not custom aside divs"), so this
 * fixes it once, here, rather than requiring every generated app to work
 * around it individually.
 */

declare global {
  // eslint-disable-next-line no-var
  var AIKitComponents: Record<string, React.ComponentType<any>> | undefined
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width })
  window.matchMedia = ((query: string) => {
    const matches = query.includes('max-width: 767px') ? width < 768 : false
    return {
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList
  }) as typeof window.matchMedia
}

let currentRoot: Root | null = null
let currentHost: HTMLElement | null = null

function render(el: React.ReactElement): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(el))
  currentRoot = root
  currentHost = host
  return host
}

beforeAll(() => {
  ;(globalThis as any).React = React
  const src = readFileSync(join(process.cwd(), 'public/aikit-components.js'), 'utf8')
  // eslint-disable-next-line no-new-func
  new Function(src)()
  expect(globalThis.AIKitComponents).toBeTruthy()
})

afterEach(() => {
  if (currentRoot) act(() => currentRoot!.unmount())
  if (currentHost) currentHost.remove()
  currentRoot = null
  currentHost = null
  setViewportWidth(1280) // reset to desktop default between tests
})

describe('AIKitSidebar — desktop (unchanged behavior)', () => {
  it('renders sticky, full-height, no hamburger, no overlay at desktop width', () => {
    setViewportWidth(1280)
    const { AIKitSidebar } = globalThis.AIKitComponents!
    const host = render(
      React.createElement(AIKitSidebar, {
        title: 'App',
        items: [{ id: 'dashboard', label: 'Dashboard' }],
      }),
    )
    const aside = host.querySelector('aside')!
    expect(aside).toBeTruthy()
    expect(aside.className).toContain('sticky')
    expect(aside.className).toContain('w-64')
    // No mobile-only chrome at desktop width.
    expect(host.querySelector('button[aria-label="Open menu"]')).toBeNull()
  })
})

describe('AIKitSidebar — mobile (#844 follow-up: the real fix)', () => {
  it('THE BUG: is off-canvas by default at a real mobile viewport, not full-width/always-visible', () => {
    setViewportWidth(390)
    const { AIKitSidebar } = globalThis.AIKitComponents!
    const host = render(
      React.createElement(AIKitSidebar, {
        title: 'App',
        items: [{ id: 'dashboard', label: 'Dashboard' }],
      }),
    )
    const aside = host.querySelector('aside')!
    expect(aside).toBeTruthy()
    // Off-canvas via a real inline transform (JS-computed, not a Tailwind
    // class — this pipeline has a confirmed, separate bug where dynamically
    // interpolated Tailwind classes can be corrupted at serve time).
    expect((aside as HTMLElement).style.transform).toContain('translateX(-100%)')
  })

  it('renders a real, always-reachable hamburger trigger at mobile width', () => {
    setViewportWidth(390)
    const { AIKitSidebar } = globalThis.AIKitComponents!
    const host = render(
      React.createElement(AIKitSidebar, {
        title: 'App',
        items: [{ id: 'dashboard', label: 'Dashboard' }],
      }),
    )
    const trigger = host.querySelector('button[aria-label="Open menu"]')
    expect(trigger).toBeTruthy()
  })

  it('opens the sidebar (real slide-in) and shows a backdrop when the hamburger is clicked', () => {
    setViewportWidth(390)
    const { AIKitSidebar } = globalThis.AIKitComponents!
    const host = render(
      React.createElement(AIKitSidebar, {
        title: 'App',
        items: [{ id: 'dashboard', label: 'Dashboard' }],
      }),
    )
    const trigger = host.querySelector('button[aria-label="Open menu"]') as HTMLButtonElement
    act(() => trigger.click())

    const aside = host.querySelector('aside')!
    expect((aside as HTMLElement).style.transform).toContain('translateX(0)')
    // A backdrop now exists.
    expect(host.querySelector('[data-aikit-sidebar-backdrop]')).toBeTruthy()
  })

  it('closing via the X button slides the sidebar back off-canvas', () => {
    setViewportWidth(390)
    const { AIKitSidebar } = globalThis.AIKitComponents!
    const host = render(
      React.createElement(AIKitSidebar, {
        title: 'App',
        items: [{ id: 'dashboard', label: 'Dashboard' }],
      }),
    )
    act(() => (host.querySelector('button[aria-label="Open menu"]') as HTMLButtonElement).click())
    act(() => (host.querySelector('button[aria-label="Close menu"]') as HTMLButtonElement).click())

    const aside = host.querySelector('aside')!
    expect((aside as HTMLElement).style.transform).toContain('translateX(-100%)')
  })

  it('selecting a nav item on mobile closes the sidebar (real UX: navigate then get out of the way)', () => {
    setViewportWidth(390)
    const { AIKitSidebar } = globalThis.AIKitComponents!
    let clickedId: string | undefined
    const host = render(
      React.createElement(AIKitSidebar, {
        title: 'App',
        items: [{ id: 'dashboard', label: 'Dashboard' }],
        onItemClick: (id: string) => { clickedId = id },
      }),
    )
    act(() => (host.querySelector('button[aria-label="Open menu"]') as HTMLButtonElement).click())
    const navButtons = Array.from(host.querySelectorAll('nav button'))
    act(() => (navButtons[0] as HTMLButtonElement).click())

    expect(clickedId).toBe('dashboard')
    const aside = host.querySelector('aside')!
    expect((aside as HTMLElement).style.transform).toContain('translateX(-100%)')
  })

  it('the hamburger trigger hides itself while the sidebar is open (no doubled controls)', () => {
    setViewportWidth(390)
    const { AIKitSidebar } = globalThis.AIKitComponents!
    const host = render(
      React.createElement(AIKitSidebar, {
        title: 'App',
        items: [{ id: 'dashboard', label: 'Dashboard' }],
      }),
    )
    act(() => (host.querySelector('button[aria-label="Open menu"]') as HTMLButtonElement).click())
    const trigger = host.querySelector('button[aria-label="Open menu"]')!
    expect(trigger.className).toContain('hidden')
  })
})
