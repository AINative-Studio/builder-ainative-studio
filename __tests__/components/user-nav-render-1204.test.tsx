// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { UserNav } from '@/components/user-nav'
import type { Session } from 'next-auth'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — UserNav (components/user-nav.tsx, 150 lines)
 * had zero test coverage despite being reached live — dynamically imported
 * (ssr:false) by user-nav-client.tsx, which components/shared/app-header.tsx
 * renders on nearly every real page.
 *
 * Radix DropdownMenuTrigger opens on a real onPointerDown — confirmed by
 * reading @radix-ui/react-dropdown-menu's source earlier this pass
 * (workspace-switcher-render-1204.test.tsx) — a plain .click() never opens
 * it. Reused here verbatim via the same openMenu() helper pattern.
 */

const h = vi.hoisted(() => ({ signOut: vi.fn() }))
vi.mock('next-auth/react', () => h)

function jsonResponse(data: any, ok = true) {
  return { ok, json: async () => data }
}

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

async function openMenu() {
  const trigger = host.querySelector('button') as HTMLButtonElement
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }) as any)
    await Promise.resolve()
  })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('UserNav — real session-state/initials/menu-gating coverage (#1204)', () => {
  it('shows the real generic user icon (never initials) when genuinely signed out', async () => {
    render(React.createElement(UserNav, { session: null }))
    await openMenu()

    expect(document.body.textContent).toContain('Not signed in')
    expect(host.querySelector('svg.lucide-user')).not.toBeNull()
  })

  it('shows the real "Guest User" label for a genuinely guest session', async () => {
    const session = { user: { type: 'guest', email: 'guest123@example.com' } } as unknown as Session
    render(React.createElement(UserNav, { session }))
    await openMenu()

    expect(document.body.textContent).toContain('Guest User')
    expect(document.body.textContent).toContain('GU')
  })

  it('derives the real display name from session.user.name when genuinely present', async () => {
    const session = { user: { type: 'ainative', name: 'Jane Founder', email: 'jane@acme.com' } } as unknown as Session
    global.fetch = vi.fn(async () => jsonResponse({}, false)) as any
    render(React.createElement(UserNav, { session }))
    await openMenu()

    expect(document.body.textContent).toContain('Jane Founder')
    expect(document.body.textContent).toContain('jane@acme.com')
  })

  it('falls back to the real email-local-part when session.user.name is genuinely absent', async () => {
    const session = { user: { type: 'ainative', email: 'founder99@acme.com' } } as unknown as Session
    global.fetch = vi.fn(async () => jsonResponse({}, false)) as any
    render(React.createElement(UserNav, { session }))
    await openMenu()

    expect(document.body.textContent).toContain('founder99')
    expect(host.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe('FO')
  })

  it('fetches the real /api/credits only for a genuinely AINative session type, never for guest/signed-out', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ credits: { remaining: 500 }, usage: {} })) as any
    const session = { user: { type: 'ainative', email: 'a@b.com' } } as unknown as Session
    render(React.createElement(UserNav, { session }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/credits')
  })

  it('renders the real remaining-credits line once the real fetch resolves, for an AINative session', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ credits: { remaining: 1234 }, usage: {} })) as any
    const session = { user: { type: 'ainative', email: 'a@b.com' } } as unknown as Session
    render(React.createElement(UserNav, { session }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await openMenu()

    expect(document.body.textContent).toContain('1,234 credits')
  })

  it('never shows a credits line for a genuinely guest session, even if somehow credits data were present', async () => {
    global.fetch = vi.fn() as any
    const session = { user: { type: 'guest', email: 'g@b.com' } } as unknown as Session
    render(React.createElement(UserNav, { session }))
    await openMenu()

    expect(global.fetch).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('credits')
  })

  it('shows the real signed-in nav links (Design Tokens/Quality Insights/API Credentials) only when genuinely not signed out', async () => {
    const session = { user: { type: 'ainative', email: 'a@b.com' } } as unknown as Session
    global.fetch = vi.fn(async () => jsonResponse({}, false)) as any
    render(React.createElement(UserNav, { session }))
    await openMenu()

    expect(document.body.textContent).toContain('Design Tokens')
    expect(document.body.textContent).toContain('Quality Insights')
    expect(document.body.textContent).toContain('API Credentials')
  })

  it('never shows the signed-in nav links when genuinely signed out', async () => {
    render(React.createElement(UserNav, { session: null }))
    await openMenu()

    expect(document.body.textContent).not.toContain('Design Tokens')
  })

  it('shows "Error Monitoring" only for a genuinely admin role, never for a normal signed-in user', async () => {
    const admin = { user: { type: 'ainative', email: 'a@b.com', role: 'admin' } } as unknown as Session
    global.fetch = vi.fn(async () => jsonResponse({}, false)) as any
    render(React.createElement(UserNav, { session: admin }))
    await openMenu()
    expect(document.body.textContent).toContain('Error Monitoring')

    act(() => { root.unmount() })
    document.body.innerHTML = ''
    const nonAdmin = { user: { type: 'ainative', email: 'a@b.com', role: 'member' } } as unknown as Session
    render(React.createElement(UserNav, { session: nonAdmin }))
    await openMenu()
    expect(document.body.textContent).not.toContain('Error Monitoring')
  })

  it('shows the real "Create Account"/"Sign In" links for a genuinely guest OR signed-out session, never for a normal signed-in user', async () => {
    const session = { user: { type: 'guest', email: 'g@b.com' } } as unknown as Session
    render(React.createElement(UserNav, { session }))
    await openMenu()
    expect(document.body.textContent).toContain('Create Account')
    expect(document.body.textContent).toContain('Sign In')

    act(() => { root.unmount() })
    document.body.innerHTML = ''
    const normal = { user: { type: 'ainative', email: 'a@b.com' } } as unknown as Session
    global.fetch = vi.fn(async () => jsonResponse({}, false)) as any
    render(React.createElement(UserNav, { session: normal }))
    await openMenu()
    expect(document.body.textContent).not.toContain('Create Account')
  })

  it('never shows "Sign out" when genuinely signed out, shows it for every other real session state', async () => {
    render(React.createElement(UserNav, { session: null }))
    await openMenu()
    expect(document.body.textContent).not.toContain('Sign out')

    act(() => { root.unmount() })
    document.body.innerHTML = ''
    const guest = { user: { type: 'guest', email: 'g@b.com' } } as unknown as Session
    render(React.createElement(UserNav, { session: guest }))
    await openMenu()
    expect(document.body.textContent).toContain('Sign out')
  })

  it('a real Sign out click calls the real signOut() with callbackUrl / and redirect:true', async () => {
    const session = { user: { type: 'ainative', email: 'a@b.com' } } as unknown as Session
    global.fetch = vi.fn(async () => jsonResponse({}, false)) as any
    render(React.createElement(UserNav, { session }))
    await openMenu()

    const signOutItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((el) => el.textContent?.includes('Sign out')) as HTMLElement
    await act(async () => { signOutItem.click(); await Promise.resolve() })

    expect(h.signOut).toHaveBeenCalledWith({ callbackUrl: '/', redirect: true })
  })
})
