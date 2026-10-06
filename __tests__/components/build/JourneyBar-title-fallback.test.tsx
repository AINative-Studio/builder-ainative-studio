// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }))
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: { track: 'company', view: 'thesis', done: {}, auto: false },
    views: ['thesis', 'unmappedFutureView'],
    dispatch: vi.fn(),
    goView: vi.fn(),
    woven: 0,
    totalPrimitives: 10,
  }),
}))
vi.mock('@/components/build/WorkspaceShell', () => ({ currentActIndex: () => 0 }))

import { JourneyBar } from '@/components/build/JourneyBar'

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

describe('JourneyBar chip labels (#BLD-08)', () => {
  it('shows the plain ARTIFACT_TITLES label, not the raw view id, for a mapped view', () => {
    render(React.createElement(JourneyBar))
    expect(host.textContent).toContain('Your business thesis')
    expect(host.textContent).not.toContain('>thesis<')
  })

  it('falls back to the raw view id for an unmapped view rather than rendering blank', () => {
    render(React.createElement(JourneyBar))
    expect(host.textContent).toContain('unmappedFutureView')
  })
})
