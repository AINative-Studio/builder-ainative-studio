// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

/**
 * AIKit shim render-hardening (wallkind crash class, 2026-08-27).
 *
 * A real user's generated app passed actions={[{label, variant}]} to
 * AIKitHeader; the shim rendered the raw object as a React child, React threw
 * "Objects are not valid as a React child (found: object with keys {label,
 * variant})", and the app-level ErrorBoundary white-screened the ENTIRE app.
 *
 * These tests load the REAL public/aikit-components.js into jsdom and assert:
 *   1. The exact reported prop shape renders (as real buttons) instead of throwing.
 *   2. Object user / title / nav labels / table cells coerce safely.
 *   3. The per-component boundary keeps one bad component from killing the tree.
 */

declare global {
  // eslint-disable-next-line no-var
  var AIKitComponents: Record<string, React.ComponentType<any>> | undefined
}

function render(el: React.ReactElement): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(el))
  return host
}

beforeAll(() => {
  ;(globalThis as any).React = React
  const src = readFileSync(join(process.cwd(), 'public/aikit-components.js'), 'utf8')
  // The shim is a browser IIFE that registers window.AIKitComponents.
  // eslint-disable-next-line no-new-func
  new Function(src)()
  expect(globalThis.AIKitComponents).toBeTruthy()
})

describe('AIKitHeader — the exact wallkind crash shape', () => {
  it('renders actions=[{label, variant}] as buttons instead of throwing', () => {
    const { AIKitHeader } = globalThis.AIKitComponents!
    const host = render(
      React.createElement(AIKitHeader, {
        title: 'Wallkind',
        actions: [
          { label: 'Sign in', variant: 'ghost' },
          { label: 'Get started', variant: 'primary' },
        ],
      }),
    )
    expect(host.textContent).toContain('Wallkind')
    expect(host.textContent).toContain('Sign in')
    expect(host.textContent).toContain('Get started')
    expect(host.querySelectorAll('button').length).toBeGreaterThanOrEqual(2)
  })

  it('renders a single object action and an object user (initials) safely', () => {
    const { AIKitHeader } = globalThis.AIKitComponents!
    const host = render(
      React.createElement(AIKitHeader, {
        title: { label: 'Object Title' }, // object title must not throw
        actions: { label: 'Upgrade', variant: 'primary' },
        user: { name: 'Greg Rose' },
        navItems: [{ label: { label: 'Nested' }, href: '#' }],
      }),
    )
    expect(host.textContent).toContain('Object Title')
    expect(host.textContent).toContain('Upgrade')
    expect(host.textContent).toContain('GR') // initials from user.name
    expect(host.textContent).toContain('Nested')
  })
})

describe('AIKitTable — object cells and labels', () => {
  it('coerces object cell values/labels to their label-like field', () => {
    const { AIKitTable } = globalThis.AIKitComponents!
    const host = render(
      React.createElement(AIKitTable, {
        columns: [{ key: 'status', label: { label: 'Status' } }],
        data: [{ status: { label: 'Active', variant: 'success' } }],
      }),
    )
    expect(host.textContent).toContain('Status')
    expect(host.textContent).toContain('Active')
  })
})

describe('per-component boundary', () => {
  it('a crashing component renders nothing instead of propagating', () => {
    const { AIKitTable } = globalThis.AIKitComponents!
    // columns: null forces the component body to throw (null.map) — the
    // boundary must swallow it so siblings keep rendering.
    const host = render(
      React.createElement(
        'div',
        null,
        React.createElement(AIKitTable, { columns: null as any, data: null as any }),
        React.createElement('span', null, 'still alive'),
      ),
    )
    expect(host.textContent).toContain('still alive')
  })
})
