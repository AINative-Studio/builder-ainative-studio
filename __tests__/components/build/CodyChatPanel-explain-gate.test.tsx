// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

const dispatchMock = vi.fn()
let mockState: any = {
  view: 'preview', track: 'company', idea: 'x', companyName: 'Acme', generated: {}, appChatId: 'chat-1', auto: true, nudgeState: {},
}
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: mockState,
    views: ['design', 'thesis', 'preview'],
    dispatch: dispatchMock,
  }),
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

describe('CodyChatPanel — explain before building (#BLD-06.9)', () => {
  it('shows a real explanation and a go-ahead button on a build-stage view (preview)', async () => {
    mockState = { view: 'preview', track: 'company', idea: 'x', companyName: 'Acme', generated: {}, appChatId: 'chat-1', auto: true, nudgeState: {} }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/build/cody-explain') return { ok: true, json: async () => ({ ok: true, explanation: "I'm about to build your live preview to test real signups." }) }
      return { ok: true, json: async () => ({ ok: true, summary: 'x' }) }
    }))
    render(React.createElement(CodyChatPanel))
    await tick()
    expect(host.textContent).toContain('live preview')
    expect(host.querySelector('[data-testid="cody-explain-go-ahead"]')).toBeTruthy()
  })

  it('does NOT show the go-ahead gate on a non-build-stage view (thesis)', async () => {
    mockState = { view: 'thesis', track: 'company', idea: 'x', companyName: 'Acme', generated: {}, appChatId: 'chat-1', auto: false, nudgeState: {} }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, summary: 'x' }) })))
    render(React.createElement(CodyChatPanel))
    await tick()
    expect(host.querySelector('[data-testid="cody-explain-go-ahead"]')).toBeFalsy()
  })

  it('once accepted, dispatches NUDGE accepted for this view so the gate does not reappear', async () => {
    mockState = { view: 'preview', track: 'company', idea: 'x', companyName: 'Acme', generated: {}, appChatId: 'chat-1', auto: true, nudgeState: {} }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/build/cody-explain') return { ok: true, json: async () => ({ ok: true, explanation: 'Building the preview.' }) }
      return { ok: true, json: async () => ({ ok: true, summary: 'x' }) }
    }))
    render(React.createElement(CodyChatPanel))
    await tick()
    const goAhead = host.querySelector('[data-testid="cody-explain-go-ahead"]') as HTMLButtonElement
    await act(async () => { goAhead.click() })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'NUDGE', view: 'preview', state: 'accepted' })
  })
})
