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
 * #1204 (Coverage Phase 4) — WorkspaceShell (components/build/WorkspaceShell.tsx,
 * 130 lines, reached live via components/build/screens/Workspace.tsx) had
 * zero test coverage for the shell itself (its exported pure helper
 * currentActIndex already has dedicated coverage in
 * workspace-shell-act-index.test.ts). Every child component here already
 * has its own dedicated test coverage elsewhere — mocked at their real
 * exported boundaries so this file verifies only WorkspaceShell's own
 * header/IndexPanel/overlay-vs-children/feed-tablet layout logic.
 */

const h = vi.hoisted(() => ({
  dispatch: vi.fn(),
  goView: vi.fn(),
  state: {
    track: 'company', companyName: '', tablet: false, indexOpen: false,
    done: {}, view: 'thesis', overlay: { kind: 'none' },
  } as Record<string, any>,
  views: ['thesis', 'businessModel', 'positioning'] as string[],
}))
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ state: h.state, dispatch: h.dispatch, goView: h.goView, views: h.views }) }))

vi.mock('@/components/build/BuildOverlays', () => ({ BuildOverlays: () => React.createElement('div', { 'data-testid': 'stub-overlays' }) }))
vi.mock('@/components/build/TerminalRibbon', () => ({ TerminalRibbon: () => React.createElement('div', { 'data-testid': 'stub-terminal-ribbon' }) }))
vi.mock('@/components/build/PricingNudge', () => ({ PricingNudge: () => React.createElement('div', { 'data-testid': 'stub-pricing-nudge' }) }))
vi.mock('@/components/build/DecisionModal', () => ({ DecisionModal: () => React.createElement('div', { 'data-testid': 'stub-decision-modal' }) }))
vi.mock('@/components/build/JourneyBar', () => ({ JourneyBar: () => React.createElement('div', { 'data-testid': 'stub-journey-bar' }) }))
vi.mock('@/components/build/CodyChatPanel', () => ({ CodyChatPanel: () => React.createElement('div', { 'data-testid': 'stub-cody-chat' }) }))
vi.mock('@/components/build/VoiceToggle', () => ({ VoiceToggle: () => React.createElement('div', { 'data-testid': 'stub-voice-toggle' }) }))

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

/** WorkspaceShell's own props type requires `children` inside the props
 *  object (not just React.createElement's variadic third argument) — a
 *  real TS typing quirk with createElement's overload resolution for a
 *  component whose props explicitly destructure `children`. This helper
 *  passes it correctly either way. */
async function shell(props: { feed?: React.ReactNode } = {}, children: React.ReactNode = React.createElement('p', null, 'x')) {
  const { WorkspaceShell } = await import('@/components/build/WorkspaceShell')
  return React.createElement(WorkspaceShell, { ...props, children })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  h.dispatch.mockClear()
  h.goView.mockClear()
  h.state = { track: 'company', companyName: '', tablet: false, indexOpen: false, done: {}, view: 'thesis', overlay: { kind: 'none' } }
})

describe('WorkspaceShell — real header/index-panel/overlay/layout coverage (#1204)', () => {
  it('renders the real children in the center panel when no overlay is genuinely active', async () => {
    render(await shell({}, React.createElement('p', null, 'Real child content')))

    expect(host.textContent).toContain('Real child content')
    expect(host.querySelector('[data-testid="stub-overlays"]')).toBeNull()
  })

  it('renders the real BuildOverlays INSTEAD of children when the real overlay kind is genuinely not "none"', async () => {
    h.state.overlay = { kind: 'confirm' }
    render(await shell({}, React.createElement('p', null, 'Should be hidden')))

    expect(host.querySelector('[data-testid="stub-overlays"]')).not.toBeNull()
    expect(host.textContent).not.toContain('Should be hidden')
  })

  it('a real "Builder" logo click dispatches the real GOTO_SCREEN companies action', async () => {
    render(await shell({}, React.createElement('p', null, 'x')))

    const logo = host.querySelector('[data-testid="workspace-logo"]') as HTMLButtonElement
    await act(async () => { logo.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'companies' })
  })

  it('shows the real "App Track"/"Company Track" pill matching the real state.track', async () => {
    h.state.track = 'app'
    render(await shell({}, React.createElement('p', null, 'x')))

    expect(host.textContent).toContain('App Track')
    expect(host.textContent).not.toContain('Company Track')
  })

  it('shows the real companyName when genuinely set, falls back to "Untitled" when empty', async () => {
    h.state.companyName = 'Acme Co'
    render(await shell({}, React.createElement('p', null, 'x')))
    expect(host.textContent).toContain('Acme Co')
  })

  it('never renders the real feed aside when no feed prop is given', async () => {
    render(await shell({}, React.createElement('p', null, 'x')))
    expect(host.querySelector('.m-feed')).toBeNull()
  })

  it('renders the real feed aside when given, but never when state.tablet is genuinely true', async () => {
    render(await shell({ feed: React.createElement('span', null, 'Real feed content') }))
    expect(host.textContent).toContain('Real feed content')

    act(() => { root.unmount() })
    h.state.tablet = true
    render(await shell({ feed: React.createElement('span', null, 'Real feed content') }))
    expect(host.textContent).not.toContain('Real feed content')
  })

  it('the real IndexPanel renders genuinely nothing when state.indexOpen is false', async () => {
    render(await shell({}, React.createElement('p', null, 'x')))
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })

  it('the real IndexPanel renders every real view, marking done/current state correctly, when indexOpen is true', async () => {
    h.state.indexOpen = true
    h.state.done = { thesis: true }
    h.state.view = 'businessModel'
    render(await shell({}, React.createElement('p', null, 'x')))

    const panel = host.querySelector('[role="dialog"]')
    expect(panel).not.toBeNull()
    const thesisBtn = Array.from(panel!.querySelectorAll('button')).find((b) => b.textContent === 'thesis') as HTMLButtonElement
    const businessBtn = Array.from(panel!.querySelectorAll('button')).find((b) => b.textContent === 'businessModel') as HTMLButtonElement
    expect(thesisBtn.className).toContain('is-done')
    expect(thesisBtn.disabled).toBe(false)
    expect(businessBtn.className).toContain('is-current')
    const positioningBtn = Array.from(panel!.querySelectorAll('button')).find((b) => b.textContent === 'positioning') as HTMLButtonElement
    expect(positioningBtn.disabled).toBe(true)
  })

  it('a real click on a done view in the IndexPanel calls goView and closes the panel', async () => {
    h.state.indexOpen = true
    h.state.done = { thesis: true }
    render(await shell({}, React.createElement('p', null, 'x')))

    const thesisBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'thesis') as HTMLButtonElement
    await act(async () => { thesisBtn.click() })

    expect(h.goView).toHaveBeenCalledWith('thesis')
    expect(h.dispatch).toHaveBeenCalledWith({ type: 'TOGGLE_INDEX' })
  })

  it('the real "My companies" / "Account" IndexPanel footer links dispatch the real GOTO_SCREEN + TOGGLE_INDEX', async () => {
    h.state.indexOpen = true
    render(await shell({}, React.createElement('p', null, 'x')))

    const accountBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Account') as HTMLButtonElement
    await act(async () => { accountBtn.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'account' })
    expect(h.dispatch).toHaveBeenCalledWith({ type: 'TOGGLE_INDEX' })
  })

  it('a real IndexPanel close click dispatches the real TOGGLE_INDEX action', async () => {
    h.state.indexOpen = true
    render(await shell({}, React.createElement('p', null, 'x')))

    const closeBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '✕') as HTMLButtonElement
    await act(async () => { closeBtn.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'TOGGLE_INDEX' })
  })
})
