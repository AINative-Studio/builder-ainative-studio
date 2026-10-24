// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { WedgeDraft } from '@/lib/build/state'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — Wedge (components/build/artifacts/Wedge.tsx,
 * 86 lines, reached live via components/build/ArtifactRouter.tsx <-
 * Workspace.tsx) had zero test coverage.
 */

const h = vi.hoisted(() => ({ dispatch: vi.fn(), goView: vi.fn(), state: {} as Record<string, any> }))
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ state: h.state, dispatch: h.dispatch, goView: h.goView }) }))

function makeDraft(overrides: Partial<WedgeDraft> = {}): WedgeDraft {
  return { headline: 'Win plumbers first', segment: 'Independent plumbers', motion: 'Direct outreach', proofPlan: 'Sign 10 plumbers in 30 days', ...overrides }
}

function baseState(overrides: Record<string, any> = {}) {
  return { wedgePicked: false, wedgeDraft: null, wedgeDraftError: '', ...overrides }
}

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
  h.dispatch.mockClear()
  h.goView.mockClear()
  h.state = {}
})

describe('Wedge — real 4-state branching coverage (#1204)', () => {
  it('shows the real "Finding the narrowest entry point" loading state when genuinely no draft, no error, not picked', async () => {
    h.state = baseState()
    const { Wedge } = await import('@/components/build/artifacts/Wedge')
    render(React.createElement(Wedge))

    expect(host.textContent).toContain('Finding the narrowest entry point for your idea')
  })

  it('shows the real draft headline/segment/motion/proofPlan + both real choice buttons once a draft genuinely lands', async () => {
    const draft = makeDraft()
    h.state = baseState({ wedgeDraft: draft })
    const { Wedge } = await import('@/components/build/artifacts/Wedge')
    render(React.createElement(Wedge))

    expect(host.textContent).toContain(draft.headline)
    expect(host.textContent).toContain(draft.segment)
    expect(host.textContent).toContain(draft.motion)
    expect(host.textContent).toContain(draft.proofPlan)
    expect(host.textContent).toContain('This is the right wedge')
    expect(host.textContent).toContain('Try a different angle')
  })

  it('a real "This is the right wedge" click dispatches the real PICK_WEDGE action', async () => {
    h.state = baseState({ wedgeDraft: makeDraft() })
    const { Wedge } = await import('@/components/build/artifacts/Wedge')
    render(React.createElement(Wedge))

    const pickBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('This is the right wedge')) as HTMLButtonElement
    await act(async () => { pickBtn.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'PICK_WEDGE' })
  })

  it('a real "Try a different angle" click dispatches the real WEDGE_DRAFT_RETRY action', async () => {
    h.state = baseState({ wedgeDraft: makeDraft() })
    const { Wedge } = await import('@/components/build/artifacts/Wedge')
    render(React.createElement(Wedge))

    const retryBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Try a different angle')) as HTMLButtonElement
    await act(async () => { retryBtn.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'WEDGE_DRAFT_RETRY' })
  })

  it('shows the real "I couldn\'t draft a wedge" error state + real "Try again" button when a genuine draft error is set', async () => {
    h.state = baseState({ wedgeDraftError: 'Generation timed out' })
    const { Wedge } = await import('@/components/build/artifacts/Wedge')
    render(React.createElement(Wedge))

    expect(host.textContent).toContain("I couldn't draft a wedge just yet")
    expect(host.textContent).toContain('Generation timed out')

    const tryAgainBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Try again')) as HTMLButtonElement
    await act(async () => { tryAgainBtn.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'WEDGE_DRAFT_RETRY' })
  })

  it('shows the real confirmation with the real re-scoped segment once wedgePicked is genuinely true and a draft exists', async () => {
    const draft = makeDraft({ segment: 'Boutique coffee roasters' })
    h.state = baseState({ wedgePicked: true, wedgeDraft: draft })
    const { Wedge } = await import('@/components/build/artifacts/Wedge')
    render(React.createElement(Wedge))

    expect(host.textContent).toContain('Sharper.')
    expect(host.textContent).toContain('Boutique coffee roasters')
    expect(host.textContent).toContain('Keep building')
  })

  it('shows the real generic "Locking that in" confirmation when picked but genuinely no draft exists', async () => {
    h.state = baseState({ wedgePicked: true, wedgeDraft: null })
    const { Wedge } = await import('@/components/build/artifacts/Wedge')
    render(React.createElement(Wedge))

    expect(host.textContent).toContain('Locking that in.')
  })

  it('a real "Keep building" click on the confirmation navigates to the real "businessModel" view', async () => {
    h.state = baseState({ wedgePicked: true, wedgeDraft: makeDraft() })
    const { Wedge } = await import('@/components/build/artifacts/Wedge')
    render(React.createElement(Wedge))

    const keepBuildingBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Keep building')) as HTMLButtonElement
    await act(async () => { keepBuildingBtn.click() })

    expect(h.goView).toHaveBeenCalledWith('businessModel')
  })

  it('the real wedgePicked confirmation state takes priority over a genuine draftError — both never render together', async () => {
    h.state = baseState({ wedgePicked: true, wedgeDraft: makeDraft(), wedgeDraftError: 'stale error' })
    const { Wedge } = await import('@/components/build/artifacts/Wedge')
    render(React.createElement(Wedge))

    expect(host.textContent).toContain('Sharper.')
    expect(host.textContent).not.toContain("I couldn't draft a wedge")
  })
})
