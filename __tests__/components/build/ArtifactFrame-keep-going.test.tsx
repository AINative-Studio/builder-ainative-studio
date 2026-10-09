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
 * #1038: once state.auto becomes false (via "Take the wheel", or via resuming
 * an in-progress build — START_BUILD's resume path per #1033 deliberately
 * leaves auto:false), there was NO UI affordance anywhere that dispatched
 * KEEP_GOING (auto: true) — the reducer case existed but had zero callers.
 * Autoplay's own gate (useAutoplay.ts:82-83) means a paused-but-unfinished
 * build silently stopped generating forever.
 *
 * This test asserts ArtifactFrame renders a "Keep going" button, wired to
 * dispatch({ type: 'KEEP_GOING' }), exactly when the build is paused
 * (!state.auto) AND the active track still has undone/non-errored views
 * remaining — mirroring useAutoplay.ts's own trackViews(state.track) +
 * state.done/state.genError "next" lookup, not a reinvented check.
 */

let mockState: any
const dispatchMock = vi.fn()
const goViewMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: mockState,
    views: ['thesis', 'wedge', 'businessModel', 'positioning', 'landing', 'plan30'],
    goView: goViewMock,
    dispatch: dispatchMock,
  }),
}))

import { ArtifactFrame } from '@/components/build/ArtifactFrame'

let host: HTMLElement
let root: Root

function render(view = 'businessModel') {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root.render(
      React.createElement(ArtifactFrame, { title: 'Business Model', status: 'done', view }),
    )
  })
}

function baseState(overrides: Partial<any> = {}) {
  return {
    companyName: 'Acme',
    idea: 'A coffee subscription platform',
    track: 'company',
    auto: false,
    paused: false,
    generated: {},
    done: { thesis: true, wedge: true },
    genError: {},
    appChatId: 'acme-co',
    sawPreview: false,
    conflictResolved: false,
    ...overrides,
  }
}

function keepGoingButton() {
  return Array.from(host.querySelectorAll('button')).find((b) => /keep going/i.test(b.textContent || ''))
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('ArtifactFrame "Keep going" resume affordance (#1038)', () => {
  it('renders a Keep going button when paused (auto:false) with unfinished track views', () => {
    mockState = baseState() // auto:false, businessModel/positioning/landing/plan30 all undone
    render('businessModel')

    const btn = keepGoingButton()
    expect(btn).toBeTruthy()
  })

  it('dispatches KEEP_GOING when clicked, restoring auto:true via the reducer', () => {
    mockState = baseState()
    render('businessModel')

    const btn = keepGoingButton()!
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(dispatchMock).toHaveBeenCalledWith({ type: 'KEEP_GOING' })
  })

  it('does NOT render Keep going when auto is already true', () => {
    mockState = baseState({ auto: true })
    render('businessModel')

    expect(keepGoingButton()).toBeFalsy()
  })

  it('does NOT render Keep going when the track is actually finished (no undone/non-errored views remain)', () => {
    mockState = baseState({
      auto: false,
      done: {
        design: true, thesis: true, wedge: true, businessModel: true,
        positioning: true, landing: true, plan30: true,
      },
    })
    render('plan30')

    expect(keepGoingButton()).toBeFalsy()
  })

  it('still renders the manual ‹ Back / Next › pager alongside Keep going when paused', () => {
    mockState = baseState()
    render('businessModel')

    const backBtn = Array.from(host.querySelectorAll('button')).find((b) => /back/i.test(b.textContent || ''))
    const nextBtn = Array.from(host.querySelectorAll('button')).find((b) => /next/i.test(b.textContent || ''))
    expect(backBtn).toBeTruthy()
    expect(nextBtn).toBeTruthy()
    expect(keepGoingButton()).toBeTruthy()
  })
})
