// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

import { BrandPanel } from '@/components/build/screens/Auth'

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

describe('Auth.tsx BrandPanel — plain language (#BLD-11)', () => {
  it('does not say "primitives" or "building blocks"', () => {
    render(React.createElement(BrandPanel))
    expect(host.textContent).not.toMatch(/primitives|building blocks/i)
  })

  it('names a concrete outcome (website, plan, or customers)', () => {
    render(React.createElement(BrandPanel))
    expect(host.textContent).toMatch(/website|plan|customers/i)
  })
})
