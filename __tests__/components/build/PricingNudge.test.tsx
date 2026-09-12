// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MAX_SHOWN, PRICING_NUDGE_KEY } from '@/lib/build/pricing-nudge'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #653 — the autopilot pricing nudge. Renders only while Cody is actively
 * driving the build (state.auto), is capped at MAX_SHOWN showings total per
 * browser, and can be dismissed early by the founder.
 */

let mockState: any
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: mockState }),
}))

import { PricingNudge } from '@/components/build/PricingNudge'

let host: HTMLElement
let root: Root

function render() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(React.createElement(PricingNudge)) })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  window.localStorage.clear()
  vi.clearAllMocks()
})

describe('PricingNudge (#653)', () => {
  it('renders the usage-based pricing message while Cody is actively driving', () => {
    mockState = { auto: true }
    render()
    const nudge = host.querySelector('[data-testid="pricing-nudge"]')
    expect(nudge).not.toBeNull()
    expect(nudge?.textContent).toMatch(/billed on usage, not seats/i)
  })

  it('renders nothing when the founder has manual control (auto=false)', () => {
    mockState = { auto: false }
    render()
    expect(host.querySelector('[data-testid="pricing-nudge"]')).toBeNull()
  })

  it('can be dismissed, and stays dismissed for that mount', () => {
    mockState = { auto: true }
    render()
    const dismiss = host.querySelector('[data-testid="pricing-nudge-dismiss"]') as HTMLButtonElement
    expect(dismiss).not.toBeNull()
    act(() => { dismiss.click() })
    expect(host.querySelector('[data-testid="pricing-nudge"]')).toBeNull()
  })

  it('stops showing after MAX_SHOWN total showings across separate mounts (build runs)', () => {
    mockState = { auto: true }
    for (let i = 0; i < MAX_SHOWN; i++) {
      render()
      expect(host.querySelector('[data-testid="pricing-nudge"]')).not.toBeNull()
      act(() => { root.unmount() })
      host.remove()
    }
    render()
    expect(host.querySelector('[data-testid="pricing-nudge"]')).toBeNull()
    expect(window.localStorage.getItem(PRICING_NUDGE_KEY)).toBe(String(MAX_SHOWN))
  })
})
