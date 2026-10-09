// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

let currentView = 'brief'
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: { view: currentView } }),
}))

import { CodyChatPanel } from '@/components/build/CodyChatPanel'

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
})

describe('CodyChatPanel (#BLD-06.1)', () => {
  it('renders a persistent chat panel with the Cody header', () => {
    currentView = 'brief'
    render(React.createElement(CodyChatPanel))
    expect(host.querySelector('[data-testid="cody-chat-panel"]')).toBeTruthy()
    expect(host.textContent).toContain('Cody')
  })

  it('names the current artifact view in its message', () => {
    currentView = 'brief'
    render(React.createElement(CodyChatPanel))
    expect(host.textContent).toContain('brief')
  })

  it('updates its message when the view changes (real reactivity, not a static render)', () => {
    currentView = 'prd'
    render(React.createElement(CodyChatPanel))
    expect(host.textContent).toContain('prd')
    expect(host.textContent).not.toContain('>brief<')
  })

  it('never renders the permanently-disabled placeholder input (BLD-06.1 shell scaffolding, superseded by the real BLD-06.3 Q&A chips + ArtifactFrame\'s "What should change?" feedback box once those shipped — a dead, non-functional input left in place would visually promise a chat box that can never work)', () => {
    currentView = 'brief'
    render(React.createElement(CodyChatPanel))
    expect(host.querySelector('[data-testid="cody-chat-input"]')).toBeFalsy()
  })
})
