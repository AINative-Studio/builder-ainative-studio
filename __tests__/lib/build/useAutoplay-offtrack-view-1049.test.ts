import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * builder#1049 — autoplay must never be left with nothing to do while the
 * workspace is still showing a generating skeleton.
 *
 * Same node-env + mocked-React-primitives approach as
 * __tests__/lib/build/useAutoplay-hook.test.ts (jsdom OOMs on this module's
 * transitive primitive-catalog import — see that file's note).
 *
 * The #1049 stall was a (track, view) pair that cannot exist in a real build:
 * track 'company' with view 'brief' (an APP-only view), produced by
 * RESTORE_BUILD merging a persisted `track` without a `view`. Autoplay's
 * `next` lookup then found every company view already done, fell into the
 * track-complete branch, and returned having dispatched nothing — because
 * that branch only acts on the app track. Result: a permanently frozen
 * "Cody is drafting this from your idea…" skeleton on 'brief'.
 *
 * RESTORE_BUILD is now the root fix (see state-restore-track-view-1049), but
 * autoplay also self-heals: if it is driving a view that is not part of the
 * active track's sequence, it steers back onto the sequence rather than
 * stalling. Belt and braces, because `view` has several unvalidated
 * GOTO_VIEW entry points (?view= deep links, CodyNudge's nudge.to, Pricing's
 * 'preview' jump) that could reintroduce the same pair from a different
 * direction.
 */

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  const effects: Array<() => void | (() => void)> = []
  ;(globalThis as any).__triggerEffect = (index = 0) => effects[index]?.()
  ;(globalThis as any).__clearEffects = () => { effects.length = 0 }
  return {
    ...actual,
    useEffect: vi.fn((fn: () => void | (() => void)) => { effects.push(fn) }),
    useRef: vi.fn((init: any) => ({ current: init })),
    useState: vi.fn((init: any) => [init, vi.fn()]),
  }
})

import { useAutoplay } from '@/lib/build/useAutoplay'
import { initialBuildState, trackViews, type BuildState } from '@/lib/build/state'

afterEach(() => {
  vi.clearAllMocks()
  ;(globalThis as any).__clearEffects?.()
})

const COMPANY_ALL_DONE: Record<string, string> = {
  design: 'done', thesis: 'done', wedge: 'done', businessModel: 'done',
  positioning: 'done', landing: 'done', plan30: 'done',
}

function ws(overrides: Partial<BuildState> = {}): BuildState {
  return {
    ...initialBuildState,
    screen: 'ws',
    auto: true,
    paused: false,
    idea: 'a brilliant idea',
    askedPrivacy: true,
    ...overrides,
  } as BuildState
}

describe('#1049 — autoplay never silently stalls on an off-track view', () => {
  it('REGRESSION: company track complete + view stuck on the app-only "brief" no longer dispatches nothing', () => {
    // The exact impossible pair the live stall was reproduced with.
    expect(trackViews('company')).not.toContain('brief')

    const dispatch = vi.fn()
    useAutoplay(
      ws({ track: 'company', view: 'brief', done: COMPANY_ALL_DONE, builtCompany: true }),
      dispatch,
    )
    ;(globalThis as any).__triggerEffect(0)

    // Before the fix this was zero dispatches, forever.
    expect(dispatch).toHaveBeenCalled()
    const calls = dispatch.mock.calls.map((c) => c[0])
    const goto = calls.find((a) => a.type === 'GOTO_VIEW')
    expect(goto, 'autoplay must steer back onto the active track').toBeDefined()
    expect(trackViews('company')).toContain(goto.view)
    // And the stale "forming" skeleton must be cleared so the founder is not
    // left looking at a generating placeholder for a view we have left.
    expect(calls.some((a) => a.type === 'SET_OVERLAY' && a.overlay?.kind === 'none')).toBe(true)
  })

  it('steers back onto the track mid-build too, not only when the track is finished', () => {
    const dispatch = vi.fn()
    useAutoplay(
      ws({ track: 'company', view: 'brief', done: { design: 'done', thesis: 'done' } }),
      dispatch,
    )
    ;(globalThis as any).__triggerEffect(0)
    const goto = dispatch.mock.calls.map((c) => c[0]).find((a) => a.type === 'GOTO_VIEW')
    expect(goto).toBeDefined()
    expect(goto.view).toBe('wedge')
  })

  it('mirror case: app track with a company-only view steers back as well', () => {
    const dispatch = vi.fn()
    useAutoplay(ws({ track: 'app', view: 'thesis', done: { design: 'done' } }), dispatch)
    ;(globalThis as any).__triggerEffect(0)
    const goto = dispatch.mock.calls.map((c) => c[0]).find((a) => a.type === 'GOTO_VIEW')
    expect(goto).toBeDefined()
    expect(goto.view).toBe('brief')
  })

  it('does NOT hijack a SHARED_LATE_VIEW — conflict/graph/rescope-intent are legitimate detours', () => {
    for (const view of ['conflict', 'graph', 'rescope-intent'] as const) {
      const dispatch = vi.fn()
      useAutoplay(ws({ track: 'company', view, done: { design: 'done' } }), dispatch)
      ;(globalThis as any).__triggerEffect(0)
      const gotos = dispatch.mock.calls.map((c) => c[0]).filter((a) => a.type === 'GOTO_VIEW')
      // Autoplay may advance to the next real artifact (normal behaviour), but
      // it must not treat the late view as an off-track emergency and it must
      // never dispatch zero actions.
      expect(dispatch).toHaveBeenCalled()
      for (const g of gotos) expect(g.view).not.toBe(view)
      ;(globalThis as any).__clearEffects()
    }
  })

  it('leaves a VALID on-track view completely alone (no behaviour change for the happy path)', () => {
    const dispatch = vi.fn()
    useAutoplay(ws({ track: 'app', view: 'design', done: {} }), dispatch)
    ;(globalThis as any).__triggerEffect(0)
    const gotos = dispatch.mock.calls.map((c) => c[0]).filter((a) => a.type === 'GOTO_VIEW')
    // 'design' is the interrupt view AND the next step — no GOTO_VIEW needed.
    for (const g of gotos) expect(g.view).not.toBe('brief')
  })

  it('still respects the gates: off-track view does NOT wake autoplay when auto is false', () => {
    const dispatch = vi.fn()
    useAutoplay(
      ws({ auto: false, track: 'company', view: 'brief', done: COMPANY_ALL_DONE }),
      dispatch,
    )
    ;(globalThis as any).__triggerEffect(0)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('still respects the gates: off-track view does NOT wake autoplay while paused', () => {
    const dispatch = vi.fn()
    useAutoplay(
      ws({ paused: true, track: 'company', view: 'brief', done: COMPANY_ALL_DONE }),
      dispatch,
    )
    ;(globalThis as any).__triggerEffect(0)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('still respects the gates: off-track view does nothing outside the workspace screen', () => {
    const dispatch = vi.fn()
    useAutoplay(
      ws({ screen: 'live', track: 'company', view: 'brief', done: COMPANY_ALL_DONE }),
      dispatch,
    )
    ;(globalThis as any).__triggerEffect(0)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('app track genuinely complete still completes normally (MVP_DONE), not treated as off-track', () => {
    const allApp: Record<string, string> = {}
    for (const v of trackViews('app')) allApp[v] = 'done'
    const dispatch = vi.fn()
    useAutoplay(ws({ track: 'app', view: 'preview', done: allApp, builtMVP: false }), dispatch)
    ;(globalThis as any).__triggerEffect(0)
    expect(dispatch.mock.calls.map((c) => c[0].type)).toContain('MVP_DONE')
  })
})
