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
 * #1161 — CodyFeed's status line doesn't distinguish "done, autoplay
 * continuing normally" from "done, autoplay HELD pending an unactioned
 * nudge" (the #1019 hold in lib/build/useAutoplay.ts). Both render the same
 * generic "On {view}." line, so a founder watching the feed can't tell
 * progress is actually waiting on them to accept/dismiss the card below.
 *
 * This test drives CodyFeed directly with a mocked useBuild + PRIMITIVE_MAP
 * and asserts the DOM text differs between the two states.
 */

const mockState: Record<string, unknown> = {
  view: 'businessModel',
  done: {},
  genError: {},
  nudgeState: {},
}
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: mockState,
    views: ['thesis', 'wedge', 'businessModel', 'positioning', 'landing', 'plan30'],
  }),
}))
vi.mock('@/lib/build/primitives', () => ({
  PRIMITIVE_MAP: {
    businessModel: {
      nudge: { prim: 'ZeroInvoice', text: "I want billing ready.", cta: 'Wire billing' },
    },
    thesis: { nudge: null },
    wedge: { nudge: null },
    positioning: { nudge: null },
    landing: { nudge: null },
    plan30: { nudge: null },
  },
}))

import { CodyFeed } from '@/components/build/CodyFeed'

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
  mockState.view = 'businessModel'
  mockState.done = {}
  mockState.genError = {}
  mockState.nudgeState = {}
})

describe('CodyFeed status line (#1161)', () => {
  it('shows the neutral "On {view}." line when the view is done and there is no nudge', () => {
    mockState.view = 'thesis'
    mockState.done = { thesis: 'done' }
    render(React.createElement(CodyFeed))
    expect(host.textContent).toContain('On thesis.')
    expect(host.textContent).not.toContain('Waiting on you')
  })

  it('shows a distinct "waiting on you" line when the view is done and a nudge is unactioned', () => {
    mockState.view = 'businessModel'
    mockState.done = { businessModel: 'done' }
    mockState.nudgeState = {}
    render(React.createElement(CodyFeed))
    expect(host.textContent).toContain('Waiting on you')
    expect(host.textContent).not.toMatch(/On businessModel\.(?!..)/) // neutral line replaced, not just appended
  })

  it('reverts to the neutral line once the nudge is accepted', () => {
    mockState.view = 'businessModel'
    mockState.done = { businessModel: 'done' }
    mockState.nudgeState = { businessModel: 'accepted' }
    render(React.createElement(CodyFeed))
    expect(host.textContent).not.toContain('Waiting on you')
  })

  it('reverts to the neutral line once the nudge is dismissed', () => {
    mockState.view = 'businessModel'
    mockState.done = { businessModel: 'done' }
    mockState.nudgeState = { businessModel: 'dismissed' }
    render(React.createElement(CodyFeed))
    expect(host.textContent).not.toContain('Waiting on you')
  })

  it('does not show "waiting on you" while the view is still actively drafting (not done yet)', () => {
    mockState.view = 'businessModel'
    mockState.done = {}
    mockState.genError = {}
    mockState.nudgeState = {}
    render(React.createElement(CodyFeed))
    expect(host.textContent).toContain('Drafting')
    expect(host.textContent).not.toContain('Waiting on you')
  })
})
