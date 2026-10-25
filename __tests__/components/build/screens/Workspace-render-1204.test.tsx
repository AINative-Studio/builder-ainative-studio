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
 * #1204 (Coverage Phase 4) — Workspace.tsx (components/build/screens/
 * Workspace.tsx) had zero render coverage. It is a pure composition shell —
 * no branch logic of its own — so the real thing worth verifying is its
 * WIRING: every child actually renders (CodyFeed passed as WorkspaceShell's
 * `feed` prop, not as a direct child; ArtifactRouter receives the real
 * state.view). Each child already has its own dedicated render test
 * (CodyFeed/FirstRunGuide/EcosystemRunwayNote/PoweringThis/ArtifactRouter/
 * WorkspaceShell) — mocked here at their real module boundaries so this
 * file verifies only Workspace's own composition.
 */

const h = vi.hoisted(() => ({ state: {} as Record<string, any> }))
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ state: h.state }) }))

vi.mock('@/components/build/WorkspaceShell', () => ({
  WorkspaceShell: ({ feed, children }: { feed: React.ReactNode; children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'shell' },
      React.createElement('div', { 'data-testid': 'shell-feed-slot' }, feed),
      React.createElement('div', { 'data-testid': 'shell-children-slot' }, children),
    ),
}))
vi.mock('@/components/build/CodyFeed', () => ({ CodyFeed: () => React.createElement('div', { 'data-testid': 'cody-feed' }) }))
vi.mock('@/components/build/FirstRunGuide', () => ({ FirstRunGuide: () => React.createElement('div', { 'data-testid': 'first-run-guide' }) }))
vi.mock('@/components/build/EcosystemRunwayNote', () => ({ EcosystemRunwayNote: () => React.createElement('div', { 'data-testid': 'ecosystem-runway-note' }) }))
vi.mock('@/components/build/PoweringThis', () => ({ PoweringThis: ({ view }: { view: string }) => React.createElement('div', { 'data-testid': 'powering-this', 'data-view': view }) }))
vi.mock('@/components/build/ArtifactRouter', () => ({ ArtifactRouter: ({ view }: { view: string }) => React.createElement('div', { 'data-testid': 'artifact-router', 'data-view': view }) }))

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
})

describe('Workspace — composition wiring (#1204)', () => {
  it('passes CodyFeed as the real WorkspaceShell feed slot, not a direct child', async () => {
    h.state = { view: 'brief' }
    const { Workspace } = await import('@/components/build/screens/Workspace')
    render(React.createElement(Workspace))

    const feedSlot = host.querySelector('[data-testid="shell-feed-slot"]')
    expect(feedSlot?.querySelector('[data-testid="cody-feed"]')).not.toBeNull()
  })

  it('renders FirstRunGuide, EcosystemRunwayNote, PoweringThis, and ArtifactRouter as real children inside the shell', async () => {
    h.state = { view: 'brief' }
    const { Workspace } = await import('@/components/build/screens/Workspace')
    render(React.createElement(Workspace))

    const childrenSlot = host.querySelector('[data-testid="shell-children-slot"]')
    expect(childrenSlot?.querySelector('[data-testid="first-run-guide"]')).not.toBeNull()
    expect(childrenSlot?.querySelector('[data-testid="ecosystem-runway-note"]')).not.toBeNull()
    expect(childrenSlot?.querySelector('[data-testid="powering-this"]')).not.toBeNull()
    expect(childrenSlot?.querySelector('[data-testid="artifact-router"]')).not.toBeNull()
  })

  it('passes the real current state.view through to both PoweringThis and ArtifactRouter', async () => {
    h.state = { view: 'company' }
    const { Workspace } = await import('@/components/build/screens/Workspace')
    render(React.createElement(Workspace))

    expect(host.querySelector('[data-testid="powering-this"]')?.getAttribute('data-view')).toBe('company')
    expect(host.querySelector('[data-testid="artifact-router"]')?.getAttribute('data-view')).toBe('company')
  })
})
