// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

let mockOverlay: { kind: string; view?: string } = { kind: 'swarm' }
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: { overlay: mockOverlay, ribbon: [] } }),
}))

import { BuildOverlays } from '@/components/build/BuildOverlays'

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

describe('BuildOverlays — usage message during generation (#SEP-06)', () => {
  it('shows a plan-inclusive usage message on the swarm overlay, with no specific dollar or credit figure', () => {
    mockOverlay = { kind: 'swarm' }
    render(React.createElement(BuildOverlays))
    expect(host.textContent).toMatch(/included in your plan|no surprise charges/i)
    expect(host.textContent).not.toMatch(/\$\d/)
    expect(host.textContent).not.toMatch(/\d+\s*credits?/i)
  })

  it('shows the same usage message on the provisioning overlay', () => {
    mockOverlay = { kind: 'provisioning' }
    render(React.createElement(BuildOverlays))
    expect(host.textContent).toMatch(/included in your plan|no surprise charges/i)
  })

  it('does not show the usage message on the forming overlay', () => {
    mockOverlay = { kind: 'forming', view: 'thesis' }
    render(React.createElement(BuildOverlays))
    expect(host.textContent).not.toMatch(/included in your plan|no surprise charges/i)
  })
})
