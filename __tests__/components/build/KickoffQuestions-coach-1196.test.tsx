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
vi.mock('@/lib/build/anon-draft-token', () => ({ getOrCreateAnonDraftToken: () => 'tok-coach' }))

const dispatchMock = vi.fn()
// A real sales-shaped idea so recommendTeam() has something to recommend —
// mirrors the exact selectPrimitives() triggers ZeroPipeline/ZeroInvoice use.
let mockIdea = 'A CRM to track leads and send invoices for my sales team'
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: {
      track: 'company', idea: mockIdea, appSub: 'acme', companyName: 'Acme',
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
  mockIdea = 'A CRM to track leads and send invoices for my sales team'
})
async function tick(times = 4) {
  for (let i = 0; i < times; i++) await act(async () => { await Promise.resolve() })
}

function stubFetch() {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function answerAllQuestions() {
  // Mirrors KickoffQuestions.test.tsx's own pattern: "Not sure yet" on every
  // question advances through all 3 without dispatching SET_ANSWER.
  for (let i = 0; i < 3; i++) {
    const notSure = host.querySelector('[data-testid="kickoff-not-sure"]') as HTMLButtonElement
    await act(async () => { notSure.click(); await tick() })
  }
  // #1311 — the main kickoff questions now hand off to 5 founder-type
  // questions before the coach/proceed decision. Pick 'hustler' throughout
  // so no extra architect review step shows up and this helper still lands
  // exactly where it used to (the coach turn or proceed()).
  for (let i = 0; i < FOUNDER_TYPE_QUESTIONS.length; i++) {
    const hustlerOpt = FOUNDER_TYPE_QUESTIONS[i].options.find((o) => o.type === 'hustler')!
    const btn = host.querySelector(
      `[data-testid="founder-type-option"][data-value="${hustlerOpt.value}"]`,
    ) as HTMLButtonElement
    await act(async () => { btn.click(); await tick() })
  }
}

describe('KickoffQuestions — coach team recommendation (#1196)', () => {
  it('shows a free coach turn with a recommended team after the 3rd question, for a team-eligible idea', async () => {
    stubFetch()
    render(React.createElement(KickoffQuestions))
    await answerAllQuestions()
    expect(host.querySelector('[data-testid="kickoff-coach"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="kickoff-coach-team"]')).toBeTruthy()
    const members = host.querySelectorAll('[data-testid="kickoff-coach-member"]')
    expect(members.length).toBeGreaterThan(0)
  })

  it('the recommended team includes real primitive names grounded in the idea (ZeroPipeline/ZeroInvoice)', async () => {
    stubFetch()
    render(React.createElement(KickoffQuestions))
    await answerAllQuestions()
    expect(host.textContent).toContain('ZeroPipeline')
  })

  it('"Looks good, build it" proceeds — same decision path as the no-recommendation case (no new gate)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/build/credits') return { ok: true, status: 200, json: async () => ({}) }
      return { ok: true, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(React.createElement(KickoffQuestions))
    await answerAllQuestions()
    const accept = host.querySelector('[data-testid="kickoff-coach-accept"]') as HTMLButtonElement
    expect(accept).toBeTruthy()
    await act(async () => { accept.click(); await tick() })
    // Unauthenticated session (mocked above) → proceed() defers to signup,
    // the same real DEFER_BUILD path the non-coach flow already exercises.
    const calledTypes = dispatchMock.mock.calls.map((c) => c[0].type)
    expect(calledTypes).toContain('DEFER_BUILD')
  })

  it('"Add more agents to the team" routes to the existing pricing screen, not a new gate', async () => {
    stubFetch()
    render(React.createElement(KickoffQuestions))
    await answerAllQuestions()
    const addMore = host.querySelector('[data-testid="kickoff-coach-add-more"]') as HTMLButtonElement
    expect(addMore).toBeTruthy()
    await act(async () => { addMore.click() })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'pricing' })
  })

  it('an idea with no team-eligible primitive match skips the coach turn and proceeds directly (never a dead end)', async () => {
    mockIdea = 'x'
    stubFetch()
    render(React.createElement(KickoffQuestions))
    await answerAllQuestions()
    expect(host.querySelector('[data-testid="kickoff-coach"]')).toBeFalsy()
    const calledTypes = dispatchMock.mock.calls.map((c) => c[0].type)
    expect(calledTypes).toContain('DEFER_BUILD')
  })
})
