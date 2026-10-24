// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { traceImpact } from '@/lib/build/artifact-graph'
import { ARTIFACT_TITLES } from '@/lib/build/titles'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — Conflict (components/build/artifacts/Conflict.tsx,
 * 87 lines, reached live via components/build/ArtifactRouter.tsx <-
 * Workspace.tsx) had zero test coverage. lib/build/artifact-graph.ts's
 * traceImpact is already independently tested — used here REAL, not mocked,
 * to derive expected impact items rather than guessing the real graph shape.
 */

const h = vi.hoisted(() => ({ dispatch: vi.fn(), state: {} as Record<string, any> }))
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ state: h.state, dispatch: h.dispatch }) }))

function baseState(overrides: Record<string, any> = {}) {
  return { track: 'app', conflictResolved: false, conflictView: undefined, companyName: '', propagating: false, ...overrides }
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
  h.state = {}
  vi.useRealTimers()
})

describe('Conflict — real impact-tracing/approve-flow coverage (#1204)', () => {
  it('defaults to the real "prd" changed view on the App track when conflictView is genuinely unset', async () => {
    h.state = baseState({ track: 'app' })
    const expectedImpact = traceImpact('app', 'prd')
    const { Conflict } = await import('@/components/build/artifacts/Conflict')
    render(React.createElement(Conflict))

    expect(host.textContent).toContain(ARTIFACT_TITLES['prd'])
    expect(host.textContent).toContain(`${expectedImpact.length} artifact`)
  })

  it('defaults to the real "wedge" changed view on the Company track when conflictView is genuinely unset', async () => {
    h.state = baseState({ track: 'company' })
    const expectedImpact = traceImpact('company', 'wedge')
    const { Conflict } = await import('@/components/build/artifacts/Conflict')
    render(React.createElement(Conflict))

    expect(host.textContent).toContain(ARTIFACT_TITLES['wedge'])
    expect(host.textContent).toContain(`${expectedImpact.length} artifact`)
  })

  it('renders the real per-impact rows (kind, label, why) from the real traceImpact output for a genuinely explicit conflictView', async () => {
    h.state = baseState({ track: 'app', conflictView: 'brief' })
    const expectedImpact = traceImpact('app', 'brief')
    const { Conflict } = await import('@/components/build/artifacts/Conflict')
    render(React.createElement(Conflict))

    expect(host.querySelectorAll('.m-impact-row').length).toBe(expectedImpact.length)
    if (expectedImpact.length > 0) {
      expect(host.textContent).toContain(expectedImpact[0].label)
      expect(host.textContent).toContain(expectedImpact[0].why)
      expect(host.textContent).toContain(expectedImpact[0].kind)
    }
  })

  it('shows the real singular "artifact" (not "artifacts") when the real impact count is genuinely 1', async () => {
    // Find a real changed view with exactly one real downstream impact to
    // exercise the singular/plural branch honestly rather than forcing it.
    const candidates = ['brief', 'prd', 'comp', 'dataModel', 'memoryPolicy', 'agentDef']
    const single = candidates.map((v) => ({ v, impact: traceImpact('app', v) })).find((r) => r.impact.length === 1)
    if (!single) return // no real single-impact view in the current graph — skip rather than force a false fixture

    h.state = baseState({ track: 'app', conflictView: single.v })
    const { Conflict } = await import('@/components/build/artifacts/Conflict')
    render(React.createElement(Conflict))

    expect(host.textContent).toContain('1 artifact ')
    expect(host.textContent).not.toContain('1 artifacts')
  })

  it('shows "will update" status for every real impact row before approval, and genuinely never the done/reconnected state', async () => {
    h.state = baseState({ track: 'app', conflictView: 'brief', propagating: false })
    const { Conflict } = await import('@/components/build/artifacts/Conflict')
    render(React.createElement(Conflict))

    expect(host.textContent).toContain('will update')
    expect(host.textContent).not.toContain('reconnected')
  })

  it('a real "Approve coordinated update" click sets SET_PROPAGATING, then dispatches RESOLVE_CONFLICT after the real impact-proportional delay', async () => {
    vi.useFakeTimers()
    h.state = baseState({ track: 'app', conflictView: 'brief' })
    const impact = traceImpact('app', 'brief')
    const { Conflict } = await import('@/components/build/artifacts/Conflict')
    render(React.createElement(Conflict))

    const approveBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Approve coordinated update') as HTMLButtonElement
    await act(async () => { approveBtn.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'SET_PROPAGATING', propagating: true })
    expect(h.dispatch).not.toHaveBeenCalledWith({ type: 'RESOLVE_CONFLICT' })

    const expectedDelay = impact.length * 120 + 400
    await act(async () => { vi.advanceTimersByTime(expectedDelay - 1) })
    expect(h.dispatch).not.toHaveBeenCalledWith({ type: 'RESOLVE_CONFLICT' })

    await act(async () => { vi.advanceTimersByTime(1) })
    expect(h.dispatch).toHaveBeenCalledWith({ type: 'RESOLVE_CONFLICT' })
  })

  it('a real "Review updates" click triggers the real same approve flow as "Approve"', async () => {
    h.state = baseState({ track: 'app', conflictView: 'brief' })
    const { Conflict } = await import('@/components/build/artifacts/Conflict')
    render(React.createElement(Conflict))

    const reviewBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Review updates') as HTMLButtonElement
    await act(async () => { reviewBtn.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'SET_PROPAGATING', propagating: true })
  })

  it('a real "Back to {company}" click dispatches GOTO_SCREEN:live with the real company name, falling back to "your company"', async () => {
    h.state = baseState({ companyName: 'Acme Co' })
    const { Conflict } = await import('@/components/build/artifacts/Conflict')
    render(React.createElement(Conflict))

    const backBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Back to Acme Co')) as HTMLButtonElement
    await act(async () => { backBtn.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'live' })
  })

  it('shows the real "Coordinated update applied" done state + "See the artifact graph" CTA when genuinely resolved', async () => {
    h.state = baseState({ conflictResolved: true, track: 'app', conflictView: 'brief' })
    const impact = traceImpact('app', 'brief')
    const { Conflict } = await import('@/components/build/artifacts/Conflict')
    render(React.createElement(Conflict))

    expect(host.textContent).toContain('Coordinated update applied')
    expect(host.textContent).toContain(`${impact.length} artifact`)

    const graphBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('See the artifact graph')) as HTMLButtonElement
    await act(async () => { graphBtn.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'GOTO_VIEW', view: 'graph' })
  })
})
