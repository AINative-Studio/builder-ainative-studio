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
 * #1308 — the specialist team (Architect/Backend/Frontend/QA/Security, named
 * in components/build/artifacts/Swarm.tsx) is narrated ONLY on the one-time
 * Swarm screen. CodyFeed's running commentary already reports each drafted
 * artifact generically ("✓ {view} — drafted."), with no mention of who
 * actually did the work.
 *
 * The honest fix: CodyFeed knows the artifact-graph view names, and exactly
 * ONE of them ('swarm') genuinely corresponds to the specialist-team step
 * Swarm.tsx renders — there is no real per-view role mapping for any other
 * view, so this is the only place narration can credit a role without
 * fabricating a mapping. When 'swarm' is drafted, the feed line names the
 * specialist team instead of the generic "✓ swarm — drafted." line; every
 * other view keeps the existing generic line unchanged.
 */

const mockState: Record<string, unknown> = {
  view: 'infra',
  done: {},
  genError: {},
  nudgeState: {},
}
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: mockState,
    views: ['sprintPlan', 'codingStandards', 'swarm', 'infra', 'preview'],
  }),
}))
vi.mock('@/lib/build/primitives', () => ({
  PRIMITIVE_MAP: {
    sprintPlan: { nudge: null },
    codingStandards: { nudge: null },
    swarm: { nudge: null },
    infra: { nudge: null },
    preview: { nudge: null },
  },
}))

import { CodyFeed } from '@/components/build/CodyFeed'

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
  mockState.view = 'infra'
  mockState.done = {}
  mockState.genError = {}
  mockState.nudgeState = {}
})

describe('CodyFeed credits the specialist team for the swarm step (#1308)', () => {
  it('names the specialist roles once the swarm view is drafted, instead of the generic line', () => {
    mockState.view = 'infra'
    mockState.done = { swarm: 'done' }
    render(React.createElement(CodyFeed))
    expect(host.textContent).not.toContain('swarm — drafted')
    // Honest: names the real roles from Swarm.tsx, not an invented mapping.
    expect(host.textContent).toMatch(/Architect.*Backend.*Frontend.*QA.*Security/)
  })

  it('keeps the generic "— drafted." line for every other drafted view', () => {
    mockState.view = 'infra'
    mockState.done = { sprintPlan: 'done', codingStandards: 'done' }
    render(React.createElement(CodyFeed))
    expect(host.textContent).toContain('sprintPlan')
    expect(host.textContent).toContain('— drafted.')
    expect(host.textContent).not.toMatch(/Architect.*Backend.*Frontend.*QA.*Security/)
  })

  it('does not credit the specialist team when swarm has not been drafted yet', () => {
    mockState.view = 'swarm'
    mockState.done = {}
    render(React.createElement(CodyFeed))
    expect(host.textContent).not.toMatch(/Architect.*Backend.*Frontend.*QA.*Security/)
  })
})
