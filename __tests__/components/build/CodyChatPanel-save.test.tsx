// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: { view: 'thesis', track: 'company', idea: 'x', companyName: 'Acme', generated: { thesis: { headline: 'x' } }, appChatId: 'chat-1', auto: false },
    views: ['design', 'thesis'],
    dispatch: vi.fn(),
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

describe('CodyChatPanel — save (#BLD-06.4)', () => {
  it('"save this" calls the version-save endpoint with the real current content', async () => {
    const fetchMock = vi.fn(async (url: string, opts?: any) => {
      if (url === '/api/build/artifact-version') {
        const body = JSON.parse(opts.body)
        expect(body.companyId).toBe('chat-1')
        expect(body.view).toBe('thesis')
        return { ok: true, json: async () => ({ ok: true }) }
      }
      return { ok: true, json: async () => ({ ok: true, summary: 'x' }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(React.createElement(CodyChatPanel))
    await tick()
    const saveBtn = host.querySelector('[data-testid="cody-save-version"]') as HTMLButtonElement
    expect(saveBtn).toBeTruthy()
    await act(async () => { saveBtn.click(); await tick() })
    expect(fetchMock).toHaveBeenCalledWith('/api/build/artifact-version', expect.objectContaining({ method: 'POST' }))
  })
})
