// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { SystemStatusBadge } from '@/components/build/SystemStatusBadge'
import { systemBadge } from '@/lib/build/live-vs-planned'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — SystemStatusBadge (components/build/
 * SystemStatusBadge.tsx, 48 lines, reached live via
 * components/build/screens/Live.tsx / ProposalGate.tsx) had zero test
 * coverage. Uses the real systemBadge() from lib/build/live-vs-planned.ts
 * (already independently tested in live-vs-planned.test.ts) to derive
 * every expected label/modifier/status/description, rather than
 * hand-guessing them.
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

describe('SystemStatusBadge — real systemBadge() derivation coverage (#1204)', () => {
  it('renders the real "live" badge shape for a provisioned-with-url system', () => {
    render(React.createElement(SystemStatusBadge, { provisioned: true, url: 'https://co.ainative.studio' }))

    const expected = systemBadge({ provisioned: true, url: 'https://co.ainative.studio' })
    const el = host.querySelector('[data-testid="system-status-badge"]') as HTMLElement
    expect(el.textContent).toBe(expected.label)
    expect(el.getAttribute('data-status')).toBe(expected.status)
    expect(el.getAttribute('title')).toBe(expected.description)
    expect(el.className).toContain(expected.modifier)
  })

  it('renders the real "unwired" badge shape when provisioned but wired is explicitly false', () => {
    render(React.createElement(SystemStatusBadge, { provisioned: true, wired: false }))

    const expected = systemBadge({ provisioned: true, wired: false })
    const el = host.querySelector('[data-testid="system-status-badge"]') as HTMLElement
    expect(el.textContent).toBe(expected.label)
    expect(el.getAttribute('data-status')).toBe(expected.status)
  })

  it('renders the real "planned" badge shape when genuinely unprovisioned with no url', () => {
    render(React.createElement(SystemStatusBadge, {}))

    const expected = systemBadge({})
    const el = host.querySelector('[data-testid="system-status-badge"]') as HTMLElement
    expect(el.textContent).toBe(expected.label)
    expect(el.getAttribute('data-status')).toBe(expected.status)
  })

  it('an undefined wired (no scan yet) never downgrades an already-provisioned badge, matching the real helper', () => {
    render(React.createElement(SystemStatusBadge, { provisioned: true }))

    const withNoWiredInfo = systemBadge({ provisioned: true })
    const withExplicitWired = systemBadge({ provisioned: true, wired: true })
    const el = host.querySelector('[data-testid="system-status-badge"]') as HTMLElement
    expect(el.getAttribute('data-status')).toBe(withNoWiredInfo.status)
    expect(withNoWiredInfo.status).toBe(withExplicitWired.status)
  })

  it('merges a real extra className onto the .st pill alongside the real status modifier', () => {
    render(React.createElement(SystemStatusBadge, { provisioned: true, className: 'my-extra' }))

    const expected = systemBadge({ provisioned: true })
    const el = host.querySelector('[data-testid="system-status-badge"]') as HTMLElement
    expect(el.className).toContain('st')
    expect(el.className).toContain(expected.modifier)
    expect(el.className).toContain('my-extra')
  })

  it('sets aria-label to the same real description used for the title attribute', () => {
    render(React.createElement(SystemStatusBadge, { url: 'https://live.example.com' }))

    const el = host.querySelector('[data-testid="system-status-badge"]') as HTMLElement
    expect(el.getAttribute('aria-label')).toBe(el.getAttribute('title'))
  })
})
