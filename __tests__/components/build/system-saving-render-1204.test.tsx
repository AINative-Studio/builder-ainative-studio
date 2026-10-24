// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { SystemSaving } from '@/components/build/SystemSaving'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — SystemSaving (components/build/SystemSaving.tsx,
 * 23 lines, reached live via components/build/screens/Live.tsx) had zero
 * test coverage.
 */

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

describe('SystemSaving — real never-invent-a-number gating + rendering coverage (#1204)', () => {
  it('renders the real savings line with the real provider name and dollar amount', () => {
    render(React.createElement(SystemSaving, { vsProvider: 'Mailchimp', savedMonthly: 49 }))

    expect(host.querySelector('[data-testid="system-saving"]')?.textContent).toBe('$49/mo on Mailchimp — included')
  })

  it('renders nothing when vsProvider is genuinely absent, even with a real savedMonthly', () => {
    render(React.createElement(SystemSaving, { savedMonthly: 49 }))

    expect(host.innerHTML).toBe('')
  })

  it('renders nothing when savedMonthly is genuinely absent, even with a real vsProvider', () => {
    render(React.createElement(SystemSaving, { vsProvider: 'Mailchimp' }))

    expect(host.innerHTML).toBe('')
  })

  it('renders nothing when savedMonthly is genuinely zero — never invents a number', () => {
    render(React.createElement(SystemSaving, { vsProvider: 'Mailchimp', savedMonthly: 0 }))

    expect(host.innerHTML).toBe('')
  })

  it('renders nothing when savedMonthly is genuinely negative', () => {
    render(React.createElement(SystemSaving, { vsProvider: 'Mailchimp', savedMonthly: -10 }))

    expect(host.innerHTML).toBe('')
  })

  it('renders nothing when both props are genuinely absent', () => {
    render(React.createElement(SystemSaving, {}))

    expect(host.innerHTML).toBe('')
  })
})
