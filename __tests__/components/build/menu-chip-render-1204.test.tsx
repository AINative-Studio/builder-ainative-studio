// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { Session } from 'next-auth'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — MenuChip (components/build/MenuChip.tsx, 31
 * lines, reached live via components/build/screens/Live.tsx,
 * components/build/screens/Fork.tsx, components/build/screens/MyCompanies.tsx)
 * had zero test coverage. AccountMenu is already heavily independently
 * tested (8+ dedicated test files) — mocked here at its real exported
 * boundary to verify only MenuChip's own wiring: session passthrough, the
 * open/onOpenChange state it owns, and the GOTO_SCREEN dispatch translation.
 */

const h = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  dispatch: vi.fn(),
  lastAccountMenuProps: null as any,
}))
vi.mock('next-auth/react', () => ({ useSession: h.useSessionMock }))
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ dispatch: h.dispatch }) }))
vi.mock('@/components/build/AccountMenu', () => ({
  AccountMenu: (props: any) => {
    h.lastAccountMenuProps = props
    return React.createElement('div', { 'data-testid': 'stub-account-menu' },
      React.createElement('button', { 'data-testid': 'stub-open-toggle', onClick: () => props.onOpenChange(!props.open) }, 'toggle'),
      React.createElement('button', { 'data-testid': 'stub-goto-live', onClick: () => props.onScreen('live') }, 'goto live'),
    )
  },
}))

import { MenuChip } from '@/components/build/MenuChip'

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
  h.lastAccountMenuProps = null
})

describe('MenuChip — real session/open-state/dispatch wiring coverage (#1204)', () => {
  it('passes the real session from useSession straight through to AccountMenu', () => {
    const session = { user: { email: 'a@b.com' } } as unknown as Session
    h.useSessionMock.mockReturnValue({ data: session, status: 'authenticated' })
    render(React.createElement(MenuChip))

    expect(h.lastAccountMenuProps.session).toBe(session)
  })

  it('passes null when genuinely signed out', () => {
    h.useSessionMock.mockReturnValue({ data: null, status: 'unauthenticated' })
    render(React.createElement(MenuChip))

    expect(h.lastAccountMenuProps.session).toBeNull()
  })

  it('owns real open state starting closed, and toggles it via the real onOpenChange callback', async () => {
    h.useSessionMock.mockReturnValue({ data: null, status: 'unauthenticated' })
    render(React.createElement(MenuChip))

    expect(h.lastAccountMenuProps.open).toBe(false)

    const toggleBtn = host.querySelector('[data-testid="stub-open-toggle"]') as HTMLButtonElement
    await act(async () => { toggleBtn.click() })

    expect(h.lastAccountMenuProps.open).toBe(true)
  })

  it('translates a real onScreen callback into the real GOTO_SCREEN dispatch action', async () => {
    h.useSessionMock.mockReturnValue({ data: null, status: 'unauthenticated' })
    render(React.createElement(MenuChip))

    const gotoBtn = host.querySelector('[data-testid="stub-goto-live"]') as HTMLButtonElement
    await act(async () => { gotoBtn.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'live' })
  })
})
