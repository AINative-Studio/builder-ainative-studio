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
vi.mock('@/lib/build/anon-draft-token', () => ({ getOrCreateAnonDraftToken: () => 'tok-site' }))
vi.mock('@/lib/build/primitive-catalog', () => ({ recommendTeam: () => [] }))

const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: {
      track: 'company', idea: 'A plumbing business', appSub: 'acme', companyName: 'Acme',
      brandTagline: '', brandColor: '#000', answers: {}, growthIntent: true, role: '',
    },
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

async function answerFreeText(value: string) {
  const input = host.querySelector('input[type="text"]') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const submit = host.querySelector('[data-testid="kickoff-submit-freetext"]') as HTMLButtonElement
  await act(async () => { submit.click() })
}

async function answerFirst3GrowthQuestions() {
  // today, blocker, customers — skip via "Not sure yet" (today has no
  // suggestions so it's also skippable via Not sure).
  for (let i = 0; i < 3; i++) {
    const notSure = host.querySelector('[data-testid="kickoff-not-sure"]') as HTMLButtonElement
    await act(async () => { notSure.click(); await tick() })
  }
}

describe('KickoffQuestions — existing-site assessment (#1306)', () => {
  it('fetches and shows a real assessment summary when a URL is given for the site-url question', async () => {
    const html = '<html><head><title>Acme</title></head><body><h2>Sub</h2></body></html>'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('acme-plumbing.com')) {
        return { ok: true, status: 200, text: async () => html }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    }))
    render(React.createElement(KickoffQuestions))
    await answerFirst3GrowthQuestions()
    // Now on the site-url question.
    expect(host.textContent).toContain('existing website')
    await answerFreeText('acme-plumbing.com')
    await tick(6)
    expect(host.textContent?.toLowerCase()).toContain('no h1')
  })

  it('shows a clear, honest failure message when the site cannot be reached — never a fake success', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('dead-site')) throw new Error('timeout')
      return { ok: true, status: 200, json: async () => ({}) }
    }))
    render(React.createElement(KickoffQuestions))
    await answerFirst3GrowthQuestions()
    await answerFreeText('dead-site.example.com')
    await tick(6)
    expect(host.textContent?.toLowerCase()).toContain('could not reach')
  })

  it('"Continue" after the assessment result moves past kickoff into the founder-type phase', async () => {
    const html = '<html><head><title>Acme</title></head><body><h1>Hi</h1></body></html>'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('acme-plumbing.com')) {
        return { ok: true, status: 200, text: async () => html }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    }))
    render(React.createElement(KickoffQuestions))
    await answerFirst3GrowthQuestions()
    await answerFreeText('acme-plumbing.com')
    await tick(6)
    const continueBtn = host.querySelector('[data-testid="kickoff-site-assessment-continue"]') as HTMLButtonElement
    expect(continueBtn).toBeTruthy()
    await act(async () => { continueBtn.click() })
    expect(host.querySelector('[data-testid="founder-type-question"]')).toBeTruthy()
  })

  it('skipping the site-url question via "Not sure yet" never attempts a fetch', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    render(React.createElement(KickoffQuestions))
    await answerFirst3GrowthQuestions()
    const notSure = host.querySelector('[data-testid="kickoff-not-sure"]') as HTMLButtonElement
    await act(async () => { notSure.click(); await tick() })
    const assessmentCalls = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && !c[0].startsWith('/api/'),
    )
    expect(assessmentCalls.length).toBe(0)
  })
})
