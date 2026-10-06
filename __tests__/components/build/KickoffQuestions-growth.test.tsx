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
vi.mock('@/lib/build/anon-draft-token', () => ({ getOrCreateAnonDraftToken: () => 'tok-growth' }))
const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: { track: 'company', idea: 'x', appSub: 'acme', companyName: 'Acme', brandTagline: '', brandColor: '#000', answers: {}, growthIntent: true },
    dispatch: dispatchMock,
  }),
}))

import { KickoffQuestions } from '@/components/build/screens/KickoffQuestions'
import { COMPANY_GROW_BUSINESS_QUESTIONS } from '@/lib/build/kickoff-questions'

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
})

describe('KickoffQuestions — growth variant reachable (#BLD-10)', () => {
  it('shows the first COMPANY_GROW_BUSINESS_QUESTIONS question when state.growthIntent is true', () => {
    render(React.createElement(KickoffQuestions))
    expect(host.textContent).toContain(COMPANY_GROW_BUSINESS_QUESTIONS[0].text)
  })
})
