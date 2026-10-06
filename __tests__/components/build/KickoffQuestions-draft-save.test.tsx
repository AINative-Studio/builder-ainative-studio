// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'unauthenticated' }), getSession: vi.fn(async () => null) }))
vi.mock('@/components/analytics/google-analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/lib/build/value-moment', () => ({ decideLimitAction: () => 'continue' }))
vi.mock('@/lib/build/anon-draft-token', () => ({ getOrCreateAnonDraftToken: () => 'tok-test' }))
const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: { track: 'company', idea: 'x', appSub: 'acme', companyName: 'Acme', brandTagline: '', brandColor: '#000', answers: {} },
    dispatch: dispatchMock,
  }),
}))

import { KickoffQuestions } from '@/components/build/screens/KickoffQuestions'

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

describe('KickoffQuestions — anonymous draft autosave (#E3.4)', () => {
  it('answering a question saves a real draft via /api/build/anon-draft with the token', async () => {
    const fetchMock = vi.fn(async (url: string, opts?: any) => {
      if (url === '/api/build/anon-draft') {
        const body = JSON.parse(opts.body)
        expect(body.token).toBe('tok-test')
        expect(body.step).toContain('kickoff')
        return { ok: true, json: async () => ({ ok: true }) }
      }
      return { ok: true, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(React.createElement(KickoffQuestions))
    const suggestion = host.querySelector('[data-testid="kickoff-suggestion"]') as HTMLButtonElement
    await act(async () => { suggestion.click(); await tick() })
    expect(fetchMock).toHaveBeenCalledWith('/api/build/anon-draft', expect.objectContaining({ method: 'POST' }))
  })
})
