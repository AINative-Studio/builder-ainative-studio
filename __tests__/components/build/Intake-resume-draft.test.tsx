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
vi.mock('@/lib/build/anon-draft-token', () => ({ getOrCreateAnonDraftToken: () => 'tok-resume' }))
const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ state: { idea: '', track: 'company' }, dispatch: dispatchMock }) }))

import { Intake } from '@/components/build/screens/Intake'

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

describe('Intake — resume an anonymous draft (#E3.4)', () => {
  it('offers "Pick up where you left off?" when a real saved draft exists for this browser', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/build/anon-draft')) {
        return { ok: true, json: async () => ({ draft: { idea: 'a scheduling app', track: 'company', answers: {}, step: 'kickoff-1' } }) }
      }
      return { ok: true, json: async () => ({}) }
    }))
    render(React.createElement(Intake))
    await tick()
    expect(host.textContent).toContain('Pick up where you left off')
    expect(host.querySelector('[data-testid="intake-resume-continue"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="intake-resume-start-over"]')).toBeTruthy()
  })

  it('shows nothing when no draft exists for this browser', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ draft: null }) })))
    render(React.createElement(Intake))
    await tick()
    expect(host.textContent).not.toContain('Pick up where you left off')
  })

  it('"Continue" dispatches SET_IDEA with the real saved idea', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/build/anon-draft')) {
        return { ok: true, json: async () => ({ draft: { idea: 'a scheduling app', track: 'company', answers: {}, step: 'kickoff-1' } }) }
      }
      return { ok: true, json: async () => ({}) }
    }))
    render(React.createElement(Intake))
    await tick()
    const continueBtn = host.querySelector('[data-testid="intake-resume-continue"]') as HTMLButtonElement
    await act(async () => { continueBtn.click() })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'SET_IDEA', idea: 'a scheduling app' })
  })
})
