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
const dispatchMock = vi.fn()
let mockTrack: 'app' | 'company' = 'company'
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: { track: mockTrack, idea: 'x', appSub: 'acme', companyName: 'Acme', brandTagline: '', brandColor: '#000' },
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
  mockTrack = 'company'
})

describe('KickoffQuestions — Company track (#E3.2)', () => {
  it('asks one question at a time, with suggestions, free text, and Not sure yet', () => {
    mockTrack = 'company'
    render(React.createElement(KickoffQuestions))
    expect(host.textContent).toContain('Who would you like to help')
    expect(host.textContent).toContain('Not sure yet')
  })

  it('a real tap-to-answer suggestion dispatches SET_ANSWER with the real value', async () => {
    render(React.createElement(KickoffQuestions))
    const suggestion = host.querySelector('[data-testid="kickoff-suggestion"]') as HTMLButtonElement
    await act(async () => { suggestion.click() })
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_ANSWER' }))
  })

  it('"Not sure yet" never dispatches SET_ANSWER (skipping a question records nothing)', async () => {
    render(React.createElement(KickoffQuestions))
    const notSure = host.querySelector('[data-testid="kickoff-not-sure"]') as HTMLButtonElement
    await act(async () => { notSure.click() })
    expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_ANSWER' }))
  })

  it('skipping (or answering) all 3 questions always proceeds to a real decision (never a dead end)', async () => {
    render(React.createElement(KickoffQuestions))
    for (let i = 0; i < 3; i++) {
      const notSure = host.querySelector('[data-testid="kickoff-not-sure"]') as HTMLButtonElement
      await act(async () => { notSure.click() })
    }
    const calledTypes = dispatchMock.mock.calls.map((c) => c[0].type)
    expect(calledTypes).toContain('DEFER_BUILD')
  })
})

describe('KickoffQuestions — App track (#E3.3)', () => {
  it('asks the 3 real App-track questions from the backlog doc', () => {
    mockTrack = 'app'
    render(React.createElement(KickoffQuestions))
    expect(host.textContent).toContain('What should the app help people do')
  })

  it('cycles through all 3 App-track questions in order', async () => {
    mockTrack = 'app'
    render(React.createElement(KickoffQuestions))
    expect(host.textContent).toContain('What should the app help people do')
    const freetextInput = host.querySelector('input[type="text"]') as HTMLInputElement
    const freetextSubmit = host.querySelector('[data-testid="kickoff-submit-freetext"]') as HTMLButtonElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(freetextInput, 'help people schedule things')
      freetextInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { freetextSubmit.click() })
    expect(host.textContent).toContain('Who will use it')
  })
})
