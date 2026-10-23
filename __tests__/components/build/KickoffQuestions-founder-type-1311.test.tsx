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
vi.mock('@/lib/build/anon-draft-token', () => ({ getOrCreateAnonDraftToken: () => 'tok-ft' }))
vi.mock('@/lib/build/primitive-catalog', () => ({ recommendTeam: () => [] }))

const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: {
      track: 'app', idea: 'x', appSub: 'acme', companyName: 'Acme',
      brandTagline: '', brandColor: '#000', answers: {}, role: '',
    },
    dispatch: dispatchMock,
  }),
}))

import { KickoffQuestions } from '@/components/build/screens/KickoffQuestions'
import { FOUNDER_TYPE_QUESTIONS } from '@/lib/build/founder-type'

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

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })))
}

async function answerMainQuestions() {
  // App track has 3 main questions.
  for (let i = 0; i < 3; i++) {
    const notSure = host.querySelector('[data-testid="kickoff-not-sure"]') as HTMLButtonElement
    await act(async () => { notSure.click(); await tick() })
  }
}

function clickOption(testid: string, value: string) {
  const btn = host.querySelector(`[data-testid="${testid}"][data-value="${value}"]`) as HTMLButtonElement
  expect(btn).toBeTruthy()
  btn.click()
}

async function answerFounderTypeQuestions(values: string[]) {
  for (let i = 0; i < FOUNDER_TYPE_QUESTIONS.length; i++) {
    const q = FOUNDER_TYPE_QUESTIONS[i]
    const opt = q.options.find((o) => o.type === values[i]) ?? q.options[0]
    await act(async () => {
      clickOption('founder-type-option', opt.value)
      await tick()
    })
  }
}

describe('KickoffQuestions — founder-type phase (#1311)', () => {
  it('asks the 5 founder-type questions after the main kickoff questions', async () => {
    stubFetch()
    render(React.createElement(KickoffQuestions))
    await answerMainQuestions()
    expect(host.textContent).toContain(FOUNDER_TYPE_QUESTIONS[0].text)
  })

  it('dispatches SET_FOUNDER_TYPE with the correct classification after all 5 are answered', async () => {
    stubFetch()
    render(React.createElement(KickoffQuestions))
    await answerMainQuestions()
    await answerFounderTypeQuestions(['hustler', 'hustler', 'hustler', 'hustler', 'hustler'])
    const call = dispatchMock.mock.calls.find((c) => c[0].type === 'SET_FOUNDER_TYPE')
    expect(call).toBeTruthy()
    expect(call?.[0].founderType).toBe('hustler')
  })

  it('an architect classification shows an extra review step before proceeding (the one bounded behavioral hook)', async () => {
    stubFetch()
    render(React.createElement(KickoffQuestions))
    await answerMainQuestions()
    await answerFounderTypeQuestions(['architect', 'architect', 'architect', 'architect', 'architect'])
    expect(host.querySelector('[data-testid="founder-review-step"]')).toBeTruthy()
    const calledTypes = dispatchMock.mock.calls.map((c) => c[0].type)
    expect(calledTypes).not.toContain('DEFER_BUILD')
    expect(calledTypes).not.toContain('START_BUILD')
  })

  it('a hustler classification skips straight through to the real build decision — no extra step', async () => {
    stubFetch()
    render(React.createElement(KickoffQuestions))
    await answerMainQuestions()
    await answerFounderTypeQuestions(['hustler', 'hustler', 'hustler', 'hustler', 'hustler'])
    await tick()
    expect(host.querySelector('[data-testid="founder-review-step"]')).toBeFalsy()
    const calledTypes = dispatchMock.mock.calls.map((c) => c[0].type)
    expect(calledTypes).toContain('DEFER_BUILD')
  })

  it('confirming the architect review step dispatches CLEAR_FOUNDER_REVIEW and proceeds', async () => {
    stubFetch()
    render(React.createElement(KickoffQuestions))
    await answerMainQuestions()
    await answerFounderTypeQuestions(['architect', 'architect', 'architect', 'architect', 'architect'])
    const confirm = host.querySelector('[data-testid="founder-review-confirm"]') as HTMLButtonElement
    expect(confirm).toBeTruthy()
    await act(async () => { confirm.click(); await tick() })
    const calledTypes = dispatchMock.mock.calls.map((c) => c[0].type)
    expect(calledTypes).toContain('CLEAR_FOUNDER_REVIEW')
    expect(calledTypes).toContain('DEFER_BUILD')
  })
})
