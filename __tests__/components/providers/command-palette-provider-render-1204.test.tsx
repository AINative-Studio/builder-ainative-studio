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
 * #1204 (Coverage Phase 4) — CommandPaletteProvider
 * (components/providers/command-palette-provider.tsx, 32 lines, reached live
 * via app/layout.tsx — global on every page) had zero test coverage.
 * CommandPalette is already independently tested
 * (__tests__/components/command-palette-render-1204.test.tsx) — mocked here
 * at its real exported boundary to isolate only this provider's own auth
 * gating + open-state wiring.
 */

const h = vi.hoisted(() => ({ useSessionMock: vi.fn(), lastPaletteProps: null as any }))
vi.mock('next-auth/react', () => ({ useSession: h.useSessionMock }))
vi.mock('@/components/command-palette', () => ({
  CommandPalette: (props: any) => {
    h.lastPaletteProps = props
    return React.createElement('div', { 'data-testid': 'stub-command-palette' },
      React.createElement('button', { 'data-testid': 'stub-toggle', onClick: () => props.onOpenChange(!props.open) }, 'toggle'),
    )
  },
}))

import { CommandPaletteProvider } from '@/components/providers/command-palette-provider'

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
  h.lastPaletteProps = null
})

describe('CommandPaletteProvider — real auth-gating/userId/open-state coverage (#1204)', () => {
  it('renders nothing for a genuinely signed-out visitor', () => {
    h.useSessionMock.mockReturnValue({ data: null, status: 'unauthenticated' })
    render(React.createElement(CommandPaletteProvider))

    expect(host.innerHTML).toBe('')
  })

  it('renders nothing while session status is genuinely "loading", even with stale session data present', () => {
    h.useSessionMock.mockReturnValue({ data: { user: { id: 'u1' } }, status: 'loading' })
    render(React.createElement(CommandPaletteProvider))

    expect(host.innerHTML).toBe('')
  })

  it('renders nothing when authenticated but the session genuinely has no user id', () => {
    h.useSessionMock.mockReturnValue({ data: { user: {} } as unknown as Session, status: 'authenticated' })
    render(React.createElement(CommandPaletteProvider))

    expect(host.innerHTML).toBe('')
  })

  it('mounts the real CommandPalette with the real userId when genuinely authenticated', () => {
    const session = { user: { id: 'user-42', email: 'a@b.com' } } as unknown as Session
    h.useSessionMock.mockReturnValue({ data: session, status: 'authenticated' })
    render(React.createElement(CommandPaletteProvider))

    expect(host.querySelector('[data-testid="stub-command-palette"]')).not.toBeNull()
    expect(h.lastPaletteProps.userId).toBe('user-42')
  })

  it('owns real open state starting closed, and toggles it via the real onOpenChange callback', async () => {
    const session = { user: { id: 'user-42' } } as unknown as Session
    h.useSessionMock.mockReturnValue({ data: session, status: 'authenticated' })
    render(React.createElement(CommandPaletteProvider))

    expect(h.lastPaletteProps.open).toBe(false)

    const toggleBtn = host.querySelector('[data-testid="stub-toggle"]') as HTMLButtonElement
    await act(async () => { toggleBtn.click() })

    expect(h.lastPaletteProps.open).toBe(true)
  })
})
