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
})

describe('Intake — chat presentation (#E3.1)', () => {
  it("Cody's first message opens with the backlog-specified line", () => {
    render(React.createElement(Intake))
    expect(host.textContent).toContain("Tell me your idea in a sentence or two.")
  })

  // #1258: the original line implied a fully hands-off pipeline, but real
  // generation pauses for a handful of genuine product decisions (AI Kit
  // Safety, ZeroDB Functions, Agent Observability, Instant DB) that a founder
  // expecting zero interruptions hits as unplanned stops. Set honest
  // expectations up front instead of promising silence.
  it('sets honest expectations that Cody will check in a few times during generation', () => {
    render(React.createElement(Intake))
    expect(host.textContent).toContain("I'll check in with you a few times along the way")
  })

  // #2068: the old copy said "I'll ask 3 quick questions" — accurate only for
  // the idea-specific kickoff questions (APP_KICKOFF_QUESTIONS etc., 3-4
  // questions), but KickoffQuestions.tsx always chains on 5 more founder-type
  // questions (lib/build/founder-type.ts) straight after with no warning,
  // making the real total 7+. Found via live E2E testing on production.
  it('does not promise a specific, inaccurate question count (#2068)', () => {
    render(React.createElement(Intake))
    expect(host.textContent).not.toContain('3 quick questions')
  })

  it('still renders a real input the founder can type into and submit', () => {
    render(React.createElement(Intake))
    expect(host.querySelector('textarea, input[type="text"]')).toBeTruthy()
  })

  it('uses the established .m-chat-cody visual pattern, not a form header', () => {
    render(React.createElement(Intake))
    expect(host.querySelector('.m-chat-cody')).toBeTruthy()
  })
})
