// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { AINativeOAuthButton } from '@/components/ainative-oauth-button'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — AINativeOAuthButton
 * (components/ainative-oauth-button.tsx, 20 lines, reached live via
 * app/(auth)/login/page.tsx) had zero test coverage.
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

describe('AINativeOAuthButton — real href/label coverage (#1204)', () => {
  it('links to the real OAuth authorize server route', () => {
    render(React.createElement(AINativeOAuthButton))

    expect(host.querySelector('a')?.getAttribute('href')).toBe('/api/auth/ainative/authorize')
  })

  it('shows the real default label when none is given', () => {
    render(React.createElement(AINativeOAuthButton))

    expect(host.querySelector('a')?.textContent).toContain('Sign in with AINative')
  })

  it('shows a real custom label when genuinely given', () => {
    render(React.createElement(AINativeOAuthButton, { label: 'Continue with AINative' }))

    expect(host.querySelector('a')?.textContent).toContain('Continue with AINative')
  })
})
