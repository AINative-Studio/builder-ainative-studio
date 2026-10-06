// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'unauthenticated' }), getSession: vi.fn(async () => null) }))
vi.mock('@/components/analytics/google-analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/lib/build/value-moment', () => ({ decideLimitAction: () => 'continue' }))
const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ state: { idea: '', track: 'company' }, dispatch: dispatchMock }) }))

import { Intake } from '@/components/build/screens/Intake'

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

describe('Intake — chat presentation (#E3.1)', () => {
  it("Cody's first message is the exact backlog-specified line", () => {
    render(React.createElement(Intake))
    expect(host.textContent).toContain("Tell me your idea in a sentence or two. I'll ask 3 quick questions, then get to work.")
  })

  it('still renders a real input the founder can type into and submit', () => {
    render(React.createElement(Intake))
    expect(host.querySelector('textarea, input[type="text"]')).toBeTruthy()
  })

  it('uses the established .m-chat-cody visual pattern, not a form header', () => {
    render(React.createElement(Intake))
    expect(host.querySelector('.m-chat-cody')).toBeTruthy()
  })
})
