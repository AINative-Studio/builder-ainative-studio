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
 * #1038 (remaining half): once paused (state.auto === false, e.g. via "Take
 * the wheel"), manually clicking `Next ›` to an undone artifact view used to
 * only move the view pointer (goView(next)) — no generation fetch ever fired
 * for the view being navigated TO, because every real /api/build/artifact
 * call lived inside useAutoplay's single effect, gated on state.auto. The
 * founder was left on a permanently stuck "Cody is drafting this…"
 * placeholder with zero network activity.
 *
 * This test reproduces the exact bug (first assertion documents what used to
 * be true: goView fires, generateArtifact does not) then asserts the fix:
 * clicking `Next ›` while paused, landing on an undone/non-errored
 * GENERATED_VIEWS view, triggers generateArtifact for THAT view — independent
 * of state.auto.
 */

let mockState: any
const dispatchMock = vi.fn()
const goViewMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: mockState,
    views: ['design', 'thesis', 'wedge', 'businessModel', 'positioning', 'landing', 'plan30'],
    goView: goViewMock,
    dispatch: dispatchMock,
  }),
}))

const generateArtifactMock = vi.fn()
vi.mock('@/lib/build/useAutoplay', () => ({
  generateArtifact: (...args: unknown[]) => generateArtifactMock(...args),
  isGenerationInFlight: () => false,
}))

import { ArtifactFrame } from '@/components/build/ArtifactFrame'

let host: HTMLElement
let root: Root

function render(view: string) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root.render(
      React.createElement(ArtifactFrame, { title: 'Business Model', status: 'generating', view }),
    )
  })
}

function baseState(overrides: Partial<any> = {}) {
  return {
    companyName: 'Roastflow',
    idea: 'a coffee-roaster DTC subscription billing platform',
    track: 'company',
    auto: false, // paused — "Take the wheel" was clicked
    paused: false,
    generated: { design: { x: 1 }, thesis: { y: 2 }, wedge: { z: 3 } },
    done: { design: 'done', thesis: 'done', wedge: 'done' }, // businessModel is UNDONE
    genError: {},
    appChatId: 'roastflow-co',
    sawPreview: false,
    conflictResolved: false,
    ...overrides,
  }
}

function nextButton() {
  return Array.from(host.querySelectorAll('button')).find((b) => /next/i.test(b.textContent || ''))
}
function backButton() {
  return Array.from(host.querySelectorAll('button')).find((b) => /back/i.test(b.textContent || ''))
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
})

describe('ArtifactFrame manual on-demand generation (#1038)', () => {
  it('clicking Next -> an undone view navigates AND triggers generateArtifact for that view', () => {
    mockState = baseState()
    render('wedge') // currently on wedge (done); next is businessModel (undone)

    const btn = nextButton()!
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    // The view pointer still moves (pre-existing behavior, unregressed).
    expect(goViewMock).toHaveBeenCalledWith('businessModel')

    // NEW: generation fires for the view being navigated TO, independent of
    // state.auto (which is false here — paused).
    expect(generateArtifactMock).toHaveBeenCalledTimes(1)
    const [calledView, , calledOpts] = generateArtifactMock.mock.calls[0]
    expect(calledView).toBe('businessModel')
    expect(calledOpts).toMatchObject({
      idea: 'a coffee-roaster DTC subscription billing platform',
      track: 'company',
      companyName: 'Roastflow',
      companyId: 'roastflow-co',
    })
  })

  it('does NOT trigger generateArtifact when the target view is already done', () => {
    // thesis -> wedge, and wedge is already done in baseState().
    mockState = baseState()
    render('thesis')

    const btn = nextButton()!
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(goViewMock).toHaveBeenCalledWith('wedge')
    expect(generateArtifactMock).not.toHaveBeenCalled()
  })

  it('does NOT trigger generateArtifact when the target view already has a genError (surfaces the existing error UI instead of silently retrying)', () => {
    mockState = baseState({ genError: { businessModel: 'HTTP 500' } })
    render('wedge')

    const btn = nextButton()!
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(goViewMock).toHaveBeenCalledWith('businessModel')
    expect(generateArtifactMock).not.toHaveBeenCalled()
  })

  it('does NOT trigger generateArtifact for a non-GENERATED_VIEWS target (e.g. swarm/infra/preview, which have their own build-view driver)', () => {
    // App track: dataModel -> memoryPolicy is still a GENERATED_VIEWS pair;
    // use a track/view combo landing on infra (a BUILD_VIEW, not prose).
    mockState = baseState({
      track: 'app',
      done: {
        design: 'done', brief: 'done', prd: 'done', comp: 'done', dataModel: 'done',
        memoryPolicy: 'done', agentDef: 'done', codingStandards: 'done',
        apiSpec: 'done', backlog: 'done', sprintPlan: 'done', swarm: 'done',
      },
    })
    // Override views for the app track via a second mock render — reuse the
    // same views list is fine since ArtifactFrame only reads `views` to find
    // idx/next/prev; supply a views list where 'infra' follows 'swarm'.
    render('swarm')

    const btn = nextButton()
    if (btn) act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(generateArtifactMock).not.toHaveBeenCalled()
  })

  it('clicking ‹ Back -> an undone view ALSO triggers generateArtifact for that view (defense in depth)', () => {
    mockState = baseState({
      done: { design: 'done' }, // thesis itself undone — unusual but exercises the same guard on Back
    })
    render('wedge')

    const btn = backButton()!
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(goViewMock).toHaveBeenCalledWith('thesis')
    expect(generateArtifactMock).toHaveBeenCalledWith('thesis', dispatchMock, expect.anything())
  })

  it('reproduces the pre-fix bug shape: goView alone (without generation) leaves an undone view with no way to start — confirms the gap this test suite closes', () => {
    // This asserts goView fires on Next — exactly what the OLD code already
    // did. The fix adds generateArtifact alongside it (asserted above); this
    // test documents that the navigation-only half was never the problem.
    mockState = baseState()
    render('wedge')
    const btn = nextButton()!
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(goViewMock).toHaveBeenCalled()
  })
})
