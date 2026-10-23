// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

const dispatchMock = vi.fn()
const pickTrackMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ dispatch: dispatchMock, pickTrack: pickTrackMock }),
}))

import { BuildStart } from '@/components/build/screens/BuildStart'

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

/**
 * #1182 — "Launch an online store" entry point. Three things must happen
 * together when a founder picks it, per the issue's own scoping: the idea
 * text is seeded with a guaranteed ZeroCommerce trigger word (not left to
 * the founder's own prose), the Sales company-role boost is applied (the
 * SAME existing COMPANY_ROLES mechanism #448 built, not a new one), and
 * SET_ECOMMERCE_INTENT is dispatched so KickoffQuestions.tsx routes to the
 * commerce-specific question set.
 */
describe('BuildStart — "Launch an online store" entry point (#1182)', () => {
  it('renders the ecommerce entry point alongside Surprise me / Build my idea', () => {
    render(React.createElement(BuildStart))
    expect(host.querySelector('[data-testid="build-ecommerce"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="build-surprise"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="build-own-idea"]')).toBeTruthy()
  })

  it('picking it seeds a guaranteed ZeroCommerce trigger word into the idea', () => {
    render(React.createElement(BuildStart))
    const btn = host.querySelector('[data-testid="build-ecommerce"]') as HTMLButtonElement
    act(() => { btn.click() })
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_IDEA', idea: expect.stringMatching(/store/i) }),
    )
  })

  it('picking it dispatches SET_ECOMMERCE_INTENT true', () => {
    render(React.createElement(BuildStart))
    const btn = host.querySelector('[data-testid="build-ecommerce"]') as HTMLButtonElement
    act(() => { btn.click() })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'SET_ECOMMERCE_INTENT', value: true })
  })

  it('picking it forces the Sales role via the existing pickTrack mechanism (#448), not a new one', () => {
    render(React.createElement(BuildStart))
    const btn = host.querySelector('[data-testid="build-ecommerce"]') as HTMLButtonElement
    act(() => { btn.click() })
    expect(pickTrackMock).toHaveBeenCalledWith('company', 'sales')
  })

  it('does NOT force role:sales for the ordinary "Build my idea" path (no cross-contamination)', () => {
    render(React.createElement(BuildStart))
    const btn = host.querySelector('[data-testid="build-own-idea"]') as HTMLButtonElement
    act(() => { btn.click() })
    expect(pickTrackMock).toHaveBeenCalledWith('company', undefined)
    expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_ECOMMERCE_INTENT' }))
  })
})
