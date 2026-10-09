// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1033 — component-level regression for the App-track permanent lockout.
 *
 * JourneyBar's `clickable` check is `!state.auto && (isDone || isCurrent)`
 * (components/build/JourneyBar.tsx). Before the fix, MVP_DONE (and a
 * restored builtMVP) left `state.auto` stuck at `true` forever once the App
 * track finished — every single tab rendered as a normal-looking, but
 * genuinely `disabled`, <button>. This test drives the mock state the way
 * the real reducer now behaves post-fix (auto:false once builtMVP is true)
 * and asserts the DOM consequence directly: the button has no `disabled`
 * attribute and a real click actually calls goView — not just that a state
 * value changed.
 */
const mockState: Record<string, unknown> = {
  track: 'app',
  view: 'brief',
  done: { design: 'done', brief: 'done' },
  auto: true, // the buggy stuck-true value — flipped per-test below
  screen: 'ws',
  designStepDone: true,
  builtCompany: false,
  builtMVP: false,
  railOpen: false,
  indexOpen: false,
}
const goViewMock = vi.fn()
const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: mockState,
    views: ['design', 'brief', 'prd', 'comp', 'dataModel', 'memoryPolicy', 'agentDef', 'codingStandards', 'apiSpec', 'backlog', 'sprintPlan', 'swarm', 'infra', 'preview'],
    goView: goViewMock,
    dispatch: dispatchMock,
    woven: 2,
    totalPrimitives: 10,
  }),
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }))

import { JourneyBar } from '@/components/build/JourneyBar'

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

describe('JourneyBar (#1033 — App track post-MVP tab lockout)', () => {
  it('reproduces the bug: while auto=true (the pre-fix stuck value), every tab is disabled, including done ones', () => {
    mockState.auto = true
    mockState.builtMVP = true // track finished, exactly the MVP_DONE/RESTORE_BUILD scenario
    render(React.createElement(JourneyBar))
    const designChip = Array.from(host.querySelectorAll('.m-crumb')).find((el) => el.textContent === 'Design System') as HTMLButtonElement
    expect(designChip.disabled).toBe(true) // done artifact, but still inert — the bug
    act(() => { designChip.click() })
    expect(goViewMock).not.toHaveBeenCalled()
  })

  it('post-fix: once auto is false (as MVP_DONE/RESTORE_BUILD now set it), done/current tabs are genuinely clickable', () => {
    mockState.auto = false
    mockState.builtMVP = true
    render(React.createElement(JourneyBar))
    const designChip = Array.from(host.querySelectorAll('.m-crumb')).find((el) => el.textContent === 'Design System') as HTMLButtonElement
    expect(designChip.disabled).toBe(false)
    act(() => { designChip.click() })
    expect(goViewMock).toHaveBeenCalledWith('design')

    const previewChip = Array.from(host.querySelectorAll('.m-crumb')).find((el) => el.textContent?.includes('Preview')) as HTMLButtonElement
    // 'preview' is upcoming (not in `done`, not `view`) — still correctly inert,
    // proving the fix doesn't just blanket-enable everything.
    expect(previewChip.disabled).toBe(true)
  })
})
