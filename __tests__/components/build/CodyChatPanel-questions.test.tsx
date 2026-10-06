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
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: { view: 'thesis', track: 'company', idea: 'a real idea', companyName: 'Acme', generated: { thesis: { headline: 'x' } }, appChatId: 'chat-1', auto: false },
    views: ['design', 'thesis', 'wedge', 'businessmodel', 'positioning', 'landing', 'plan30'],
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

describe('CodyChatPanel — questions and revise (#BLD-06.3)', () => {
  it('shows tap-to-answer suggestions and a "Not sure yet" option for the current step', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, summary: 'x' }) })))
    render(React.createElement(CodyChatPanel))
    await tick()
    expect(host.textContent).toContain('Not sure yet')
    expect(host.querySelector('[data-testid="cody-question-suggestion"]')).toBeTruthy()
  })

  it('answering a question and confirming calls /api/build/artifact with composed feedback, then dispatches GEN_DONE', async () => {
    const fetchMock = vi.fn(async (url: string, opts?: any) => {
      if (url === '/api/build/cody-summary') return { ok: true, json: async () => ({ ok: true, summary: 'x' }) }
      if (url === '/api/build/artifact') {
        const body = JSON.parse(opts.body)
        expect(body.feedback).toContain('Q:')
        expect(body.view).toBe('thesis')
        return { ok: true, json: async () => ({ content: { headline: 'revised' } }) }
      }
      return { ok: true, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(React.createElement(CodyChatPanel))
    await tick()
    const suggestion = host.querySelector('[data-testid="cody-question-suggestion"]') as HTMLButtonElement
    await act(async () => { suggestion.click() })
    const confirmBtn = host.querySelector('[data-testid="cody-questions-submit"]') as HTMLButtonElement
    await act(async () => { confirmBtn.click(); await tick() })
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'GEN_DONE', view: 'thesis', content: { headline: 'revised' } }))
  })

  it('"Keep as is" never calls /api/build/artifact', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/build/artifact') throw new Error('must not be called')
      return { ok: true, json: async () => ({ ok: true, summary: 'x' }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(React.createElement(CodyChatPanel))
    await tick()
    const keepBtn = host.querySelector('[data-testid="cody-questions-keep"]') as HTMLButtonElement
    await act(async () => { keepBtn.click(); await tick() })
    expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'GEN_DONE' }))
  })
})
