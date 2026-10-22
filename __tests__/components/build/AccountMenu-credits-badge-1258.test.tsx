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
 * #1258 — "5 of 5 free builds used" only ever appeared AFTER the quota was
 * exhausted, buried inside the post-build upsell banner. There was no
 * persistent, always-visible remaining-quota signal anywhere in the shell.
 *
 * AccountMenu already mounts on every build screen (JourneyBar + MenuChip)
 * and already had a `m-token-meter` bar on its trigger chip — but it was
 * hardcoded to a fixed 38% fill with no real data behind it. This wires the
 * SAME GET /api/build/credits endpoint the post-build upsell already reads
 * (lib/build/build-credits.ts via app/api/build/credits/route.ts) into that
 * existing chip, so the real remaining count is visible any time the menu is
 * mounted — before, during, and after a build — not just once it's gone.
 */

vi.mock('next-auth/react', () => ({ signOut: vi.fn() }))

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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('AccountMenu — real remaining-build indicator (#1258)', () => {
  it('renders the real "N left" badge on the Credits menu item once the status loads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ used: 1, limit: 3, unlimited: false }),
    }))
    const { AccountMenu } = await import('@/components/build/AccountMenu')
    render(
      React.createElement(AccountMenu, {
        session: { user: { name: 'Toby', email: 'toby@ainative.studio' } } as any,
        open: true,
        onOpenChange: vi.fn(),
        onScreen: vi.fn(),
      }),
    )
    await flush()
    const badge = host.querySelector('[data-testid="account-menu-badge-credits"]')
    expect(badge?.textContent).toBe('2 left')
  })

  it('shows a real, non-placeholder fill on the trigger chip meter', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ used: 2, limit: 3, unlimited: false }),
    }))
    const { AccountMenu } = await import('@/components/build/AccountMenu')
    render(
      React.createElement(AccountMenu, {
        session: { user: { name: 'Toby', email: 'toby@ainative.studio' } } as any,
        open: false,
        onOpenChange: vi.fn(),
        onScreen: vi.fn(),
      }),
    )
    await flush()
    const meter = host.querySelector('[data-testid="account-chip-credits-meter"]')
    expect(meter?.getAttribute('aria-label')).toBe('Free builds: 1 left')
    const fill = meter?.querySelector('span') as HTMLElement
    expect(fill.style.width).toBe('67%')
  })

  it('never fabricates a count: no meter and no Credits badge while unloaded (fetch never resolves)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { AccountMenu } = await import('@/components/build/AccountMenu')
    render(
      React.createElement(AccountMenu, {
        session: { user: { name: 'Toby', email: 'toby@ainative.studio' } } as any,
        open: true,
        onOpenChange: vi.fn(),
        onScreen: vi.fn(),
      }),
    )
    await flush()
    expect(host.querySelector('[data-testid="account-chip-credits-meter"]')).toBeNull()
    expect(host.querySelector('[data-testid="account-menu-badge-credits"]')).toBeNull()
  })

  it('shows no meter/badge for an unlimited (paid) tier — the quota concept does not apply', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ used: 0, limit: -1, unlimited: true }),
    }))
    const { AccountMenu } = await import('@/components/build/AccountMenu')
    render(
      React.createElement(AccountMenu, {
        session: { user: { name: 'Toby', email: 'toby@ainative.studio' } } as any,
        open: true,
        onOpenChange: vi.fn(),
        onScreen: vi.fn(),
      }),
    )
    await flush()
    expect(host.querySelector('[data-testid="account-chip-credits-meter"]')).toBeNull()
    expect(host.querySelector('[data-testid="account-menu-badge-credits"]')).toBeNull()
  })

  it('never fetches credits for a guest session — no owner identity to meter', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const { AccountMenu } = await import('@/components/build/AccountMenu')
    render(
      React.createElement(AccountMenu, {
        session: null,
        open: true,
        onOpenChange: vi.fn(),
        onScreen: vi.fn(),
      }),
    )
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
