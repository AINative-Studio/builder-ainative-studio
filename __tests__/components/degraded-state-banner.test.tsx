// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { DegradedStateBanner } from '@/components/ui/degraded-state-banner'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * Issue #1191 — the user-facing half of graceful degradation. A circuit
 * breaker that silently returns defaults is only half the fix; the issue's
 * own acceptance criteria requires a VISIBLE degraded-state UI. This test
 * renders the real component with react-dom (not a snapshot) and asserts
 * the actual message text lands in the DOM.
 */

let host: HTMLElement
let root: Root

function render(el: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(el))
}

function unmount() {
  act(() => root.unmount())
  host.remove()
}

describe('DegradedStateBanner', () => {
  it('renders the degraded-state message visibly, not silently', () => {
    render(
      <DegradedStateBanner message="Using default styling — your custom design tokens are temporarily unavailable." />
    )

    const banner = host.querySelector('[data-testid="degraded-state-banner"]')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toContain(
      'Using default styling — your custom design tokens are temporarily unavailable.'
    )
    // Uses the repo's real Alert primitive (role="alert"), not a bespoke div.
    expect(banner?.getAttribute('role')).toBe('alert')

    unmount()
  })

  it('accepts a custom title', () => {
    render(<DegradedStateBanner title="Design tokens unavailable" message="Falling back to defaults." />)

    expect(host.textContent).toContain('Design tokens unavailable')
    expect(host.textContent).toContain('Falling back to defaults.')

    unmount()
  })

  it('falls back to a generic title when none is provided', () => {
    render(<DegradedStateBanner message="Something is degraded." />)

    expect(host.textContent).toContain('Reduced functionality')

    unmount()
  })
})
