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
 * builder#1254 — "no way to navigate from an active workspace back to the
 * companies list ... clicking the 'Builder' logo top-left does nothing."
 *
 * Root cause, found by reading components/build/WorkspaceShell.tsx: the
 * "Builder" brand mark in the top bar was a plain, inert <span> — no
 * onClick, no href, nothing. It rendered as a logo/home affordance (bold,
 * top-left, every other screen in the app treats that position as a nav
 * target) but was never wired to anything. This reproduces the exact DOM
 * consequence (no handler fires on click) and then verifies the fix: a
 * real <button> that dispatches GOTO_SCREEN('companies') — the same
 * destination the sibling IndexPanel "My companies" control already uses.
 */
const mockState: Record<string, unknown> = {
  screen: 'ws',
  track: 'app',
  view: 'preview',
  done: {},
  companyName: 'Morphic',
  tablet: false,
  overlay: { kind: 'none' },
  ribbon: [],
  auto: false,
  paused: false,
  pendingQ: null,
  nudgeState: {},
  generated: {},
  idea: 'a test idea',
  appChatId: '',
  indexOpen: false,
}
const dispatchMock = vi.fn()
const goViewMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: mockState,
    views: ['brief', 'preview'],
    goView: goViewMock,
    dispatch: dispatchMock,
    woven: 1,
    totalPrimitives: 10,
  }),
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }))

import { WorkspaceShell } from '@/components/build/WorkspaceShell'

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

describe('WorkspaceShell — "Builder" logo navigation (#1254)', () => {
  it('renders the brand mark as a real, clickable control (not an inert span)', () => {
    render(React.createElement(WorkspaceShell, { children: React.createElement('div') }))
    const logo = host.querySelector('[data-testid="workspace-logo"]')
    expect(logo).toBeTruthy()
    expect(logo?.tagName).toBe('BUTTON')
    expect(logo?.textContent).toBe('Builder')
  })

  it('clicking the logo navigates to the companies screen — the reported no-op is fixed', () => {
    render(React.createElement(WorkspaceShell, { children: React.createElement('div') }))
    const logo = host.querySelector('[data-testid="workspace-logo"]') as HTMLButtonElement
    act(() => { logo.click() })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'companies' })
  })
})
