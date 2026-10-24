// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { Loader } from '@/components/ai-elements/loader'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — Loader (components/ai-elements/loader.tsx, 96
 * lines, reached live via components/chat/chat-messages.tsx) had zero test
 * coverage.
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

describe('Loader — real size/className/props-passthrough coverage (#1204)', () => {
  it('renders the real default 16px icon size when no size prop is given', () => {
    render(React.createElement(Loader))
    const svg = host.querySelector('svg') as SVGElement
    expect(svg.getAttribute('width')).toBe('16')
    expect(svg.getAttribute('height')).toBe('16')
  })

  it('renders the real custom icon size when genuinely provided', () => {
    render(React.createElement(Loader, { size: 32 }))
    const svg = host.querySelector('svg') as SVGElement
    expect(svg.getAttribute('width')).toBe('32')
    expect(svg.getAttribute('height')).toBe('32')
  })

  it('applies the real "animate-spin" class and merges in a genuinely provided className', () => {
    render(React.createElement(Loader, { className: 'text-gray-500' }))
    const wrapper = host.firstElementChild as HTMLElement
    expect(wrapper.className).toContain('animate-spin')
    expect(wrapper.className).toContain('text-gray-500')
  })

  it('passes through real arbitrary HTML div attributes (e.g. a real data-testid)', () => {
    render(React.createElement(Loader, { 'data-testid': 'real-loader' } as any))
    expect(host.querySelector('[data-testid="real-loader"]')).not.toBeNull()
  })

  it('renders exactly one real svg icon', () => {
    render(React.createElement(Loader))
    expect(host.querySelectorAll('svg').length).toBe(1)
  })
})
