// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

let currentView = 'thesis'
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: { view: currentView, track: 'company', generated: { thesis: { headline: 'x' } } } }),
}))

import { CodyChatPanel } from '@/components/build/CodyChatPanel'

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
  vi.unstubAllGlobals()
})
async function tick(times = 4) {
  for (let i = 0; i < times; i++) await act(async () => { await Promise.resolve() })
}

describe('CodyChatPanel — real summary (#BLD-06.2)', () => {
  it('replaces the static line with the real summary once the API resolves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, summary: 'This is your venture thesis, plainly explained.' }) })))
    render(React.createElement(CodyChatPanel))
    await tick()
    expect(host.textContent).toContain('This is your venture thesis, plainly explained.')
  })

  it('keeps the static fallback line when the summary call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: false, reason: 'not_configured' }) })))
    render(React.createElement(CodyChatPanel))
    await tick()
    expect(host.textContent).toContain('thesis')
  })
})
