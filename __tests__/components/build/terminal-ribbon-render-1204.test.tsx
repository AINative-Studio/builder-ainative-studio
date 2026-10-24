// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView = vi.fn()
})

/**
 * #1204 (Coverage Phase 4) — TerminalRibbon (components/build/TerminalRibbon.tsx,
 * 35 lines, reached live via components/build/WorkspaceShell.tsx) had zero
 * test coverage.
 */

const h = vi.hoisted(() => ({ state: {} as Record<string, any> }))
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ state: h.state }) }))

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
  h.state = {}
})

describe('TerminalRibbon — real ribbon-line/scroll coverage (#1204)', () => {
  it('renders nothing when state.ribbon is genuinely empty', async () => {
    h.state = { ribbon: [] }
    const { TerminalRibbon } = await import('@/components/build/TerminalRibbon')
    render(React.createElement(TerminalRibbon))

    expect(host.innerHTML).toBe('')
  })

  it('renders every real ribbon line, in order, when under the 6-line cap', async () => {
    h.state = { ribbon: ['provision ▸ zerodb', 'agent:backend ▸ scaffolding /ask'] }
    const { TerminalRibbon } = await import('@/components/build/TerminalRibbon')
    render(React.createElement(TerminalRibbon))

    const lines = Array.from(host.querySelectorAll('.m-ribbon-line')).map((el) => el.textContent?.trim())
    expect(lines).toEqual(['› provision ▸ zerodb', '› agent:backend ▸ scaffolding /ask'])
  })

  it('shows only the real most-recent 6 lines when the ribbon genuinely has more', async () => {
    const all = Array.from({ length: 10 }, (_, i) => `line-${i}`)
    h.state = { ribbon: all }
    const { TerminalRibbon } = await import('@/components/build/TerminalRibbon')
    render(React.createElement(TerminalRibbon))

    const lines = Array.from(host.querySelectorAll('.m-ribbon-line')).map((el) => el.textContent?.trim())
    expect(lines).toEqual(['› line-4', '› line-5', '› line-6', '› line-7', '› line-8', '› line-9'])
  })

  it('has the real role="log" accessibility attribute for a screen reader', async () => {
    h.state = { ribbon: ['x'] }
    const { TerminalRibbon } = await import('@/components/build/TerminalRibbon')
    render(React.createElement(TerminalRibbon))

    expect(host.querySelector('[role="log"]')).not.toBeNull()
  })

  it('calls the real scrollIntoView when the ribbon length genuinely changes', async () => {
    const scrollSpy = vi.fn()
    Element.prototype.scrollIntoView = scrollSpy
    h.state = { ribbon: ['a'] }
    const { TerminalRibbon } = await import('@/components/build/TerminalRibbon')
    render(React.createElement(TerminalRibbon))

    expect(scrollSpy).toHaveBeenCalledWith({ block: 'end' })
  })
})
