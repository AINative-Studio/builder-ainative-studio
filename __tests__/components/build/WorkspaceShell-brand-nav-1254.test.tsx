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
 * #1254 — "no way to navigate from an active workspace back to the companies
 * list". Reported: the "Builder" wordmark in the workspace top bar did
 * nothing when clicked. Root cause: it was a plain, unclickable <span>. Now a
 * real button dispatching the same GOTO_SCREEN('companies') the IndexPanel's
 * own "My companies" quick-nav button already uses.
 */

const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: { track: 'app', companyName: 'Ember Box', tablet: false, indexOpen: false, overlay: { kind: 'none' } },
    dispatch: dispatchMock,
  }),
}))
vi.mock('@/components/build/BuildOverlays', () => ({ BuildOverlays: () => null }))
vi.mock('@/components/build/TerminalRibbon', () => ({ TerminalRibbon: () => null }))
vi.mock('@/components/build/PricingNudge', () => ({ PricingNudge: () => null }))
vi.mock('@/components/build/DecisionModal', () => ({ DecisionModal: () => null }))
vi.mock('@/components/build/JourneyBar', () => ({ JourneyBar: () => null }))
vi.mock('@/components/build/CodyChatPanel', () => ({ CodyChatPanel: () => null }))

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

describe('WorkspaceShell brand wordmark (#1254)', () => {
  it('is a real button, not an inert span', () => {
    render(<WorkspaceShell>{null}</WorkspaceShell>)
    const brand = host.querySelector('.m-brand') as HTMLElement
    expect(brand).toBeTruthy()
    expect(brand.tagName).toBe('BUTTON')
  })

  it('clicking it dispatches GOTO_SCREEN(companies) — the reported dead click, now wired', () => {
    render(<WorkspaceShell>{null}</WorkspaceShell>)
    const brand = host.querySelector('.m-brand') as HTMLElement
    act(() => { brand.click() })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'companies' })
  })
})
