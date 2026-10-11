import { describe, it, expect } from 'vitest'
import {
  buildReducer,
  initialBuildState,
  trackViews,
  viewBelongsToTrack,
  firstUnfinishedView,
  APP_VIEWS,
  COMPANY_VIEWS,
  SHARED_LATE_VIEWS,
  type BuildState,
} from '@/lib/build/state'

/**
 * builder#1049 — the App-track "autoplay silently stalls on the product brief"
 * stall, root-caused to a (track, view) invariant violation in RESTORE_BUILD.
 *
 * RESTORE_BUILD's persisted-field union includes `track` but deliberately NOT
 * `view` (live UI position isn't meant to be restored). The merge is a plain
 * `{ ...state, ...action.partial }`, so restoring a company-track company
 * while `state.view` is still the reducer's own initial 'brief' — an APP-ONLY
 * view — produces a pair that cannot exist in any real build:
 *
 *     track: 'company'   view: 'brief'      ('brief' ∉ COMPANY_VIEWS)
 *
 * useAutoplay then computes `next` over trackViews('company'), finds every
 * company view already done, falls into the track-complete branch, and —
 * because that branch only acts when track === 'app' — returns having
 * dispatched NOTHING. The workspace is left rendering 'brief' forever:
 * a frozen "Cody is drafting this from your idea…" skeleton, zero network
 * activity, no error, no paused indicator. Reproduced deterministically in a
 * real browser (see the #1049 investigation notes) at every session latency.
 *
 * The reachable production path is contexts/build-context.tsx's #669
 * bare-reload resume: it dispatches RESTORE_BUILD(saved) + GOTO_SCREEN('ws')
 * and — unlike the ?company= deep-link path — has NO following PICK_TRACK to
 * incidentally reset `view` to 'design'. So nothing repairs the pair.
 *
 * Fixed at the root: RESTORE_BUILD normalizes `view` against the merged
 * `track` at the single point persisted state is merged in, exactly as it
 * already normalizes `auto` for #1033. Autoplay's own "where am I" lookup is
 * reused (firstUnfinishedView), so the restored founder lands on the step
 * their build is genuinely up to rather than an arbitrary first/last view.
 */

const companyDone = {
  design: 'done', thesis: 'done', wedge: 'done', businessModel: 'done',
  positioning: 'done', landing: 'done', plan30: 'done',
} as const

describe('#1049 — viewBelongsToTrack', () => {
  it('accepts every view in the track sequence', () => {
    for (const v of APP_VIEWS) expect(viewBelongsToTrack(v, 'app')).toBe(true)
    for (const v of COMPANY_VIEWS) expect(viewBelongsToTrack(v, 'company')).toBe(true)
  })

  it('rejects a cross-track view — the exact impossible pair behind #1049', () => {
    expect(viewBelongsToTrack('brief', 'company')).toBe(false)
    expect(viewBelongsToTrack('thesis', 'app')).toBe(false)
  })

  it('accepts SHARED_LATE_VIEWS on either track — they are deliberately off-sequence', () => {
    for (const v of SHARED_LATE_VIEWS) {
      expect(viewBelongsToTrack(v, 'app')).toBe(true)
      expect(viewBelongsToTrack(v, 'company')).toBe(true)
    }
  })
})

describe('#1049 — firstUnfinishedView', () => {
  it('returns the first view with neither done nor genError — autoplay\'s own lookup', () => {
    expect(firstUnfinishedView('app', { design: 'done' }, {})).toBe('brief')
    expect(firstUnfinishedView('app', { design: 'done', brief: 'done' }, {})).toBe('prd')
    expect(firstUnfinishedView('company', { design: 'done' }, {})).toBe('thesis')
  })

  it('skips an errored view, same as autoplay', () => {
    expect(firstUnfinishedView('app', { design: 'done' }, { brief: 'boom' })).toBe('prd')
  })

  it('falls back to the LAST view once the track is complete (nothing left to draft)', () => {
    expect(firstUnfinishedView('company', companyDone, {})).toBe('plan30')
    const allApp: Record<string, string> = {}
    for (const v of APP_VIEWS) allApp[v] = 'done'
    expect(firstUnfinishedView('app', allApp, {})).toBe('preview')
  })

  it('returns the first view for a brand-new build', () => {
    expect(firstUnfinishedView('app', {}, {})).toBe('design')
    expect(firstUnfinishedView('company', {}, {})).toBe('design')
  })
})

describe('#1049 — RESTORE_BUILD keeps (track, view) coherent', () => {
  it('REGRESSION: restoring a finished COMPANY build no longer leaves view on the app-only "brief"', () => {
    // This is the reported stall, exactly: the reducer's initial view is
    // 'brief' (an APP view) and the persisted partial carries track:'company'.
    expect(initialBuildState.view).toBe('brief')
    expect(trackViews('company')).not.toContain('brief')

    const restored = buildReducer(initialBuildState, {
      type: 'RESTORE_BUILD',
      partial: {
        track: 'company',
        done: { ...companyDone },
        builtCompany: true,
        companyName: 'OldCo',
        idea: 'an old finished company',
        appSub: 'oldco-company-run',
      },
    })

    expect(restored.track).toBe('company')
    expect(viewBelongsToTrack(restored.view, 'company')).toBe(true)
    expect(restored.view).not.toBe('brief')
    // A finished track has nothing left to draft → land on its last view.
    expect(restored.view).toBe('plan30')
  })

  it('lands a HALF-FINISHED restored company build on the step it is actually up to', () => {
    const restored = buildReducer(initialBuildState, {
      type: 'RESTORE_BUILD',
      partial: {
        track: 'company',
        done: { design: 'done', thesis: 'done' },
        appSub: 'midco',
      },
    })
    expect(restored.view).toBe('wedge')
    expect(viewBelongsToTrack(restored.view, 'company')).toBe(true)
  })

  it('restoring an APP build whose view is a company-only view is repaired too (mirror case)', () => {
    const state: BuildState = { ...initialBuildState, track: 'company', view: 'thesis' }
    const restored = buildReducer(state, {
      type: 'RESTORE_BUILD',
      partial: { track: 'app', done: { design: 'done' }, appSub: 'appco' },
    })
    expect(restored.track).toBe('app')
    expect(restored.view).toBe('brief')
    expect(viewBelongsToTrack(restored.view, 'app')).toBe(true)
  })

  it('does NOT move a view that is already valid for the restored track', () => {
    const state: BuildState = { ...initialBuildState, track: 'app', view: 'agentDef' }
    const restored = buildReducer(state, {
      type: 'RESTORE_BUILD',
      partial: { track: 'app', done: { design: 'done' }, appSub: 'appco' },
    })
    expect(restored.view).toBe('agentDef')
  })

  it('does NOT move a SHARED_LATE_VIEW — those are intentionally off-sequence', () => {
    const state: BuildState = { ...initialBuildState, track: 'app', view: 'conflict' }
    const restored = buildReducer(state, {
      type: 'RESTORE_BUILD',
      partial: { track: 'company', appSub: 'x' },
    })
    expect(restored.view).toBe('conflict')
  })

  it('leaves view alone when the partial carries no track at all (the deepLinkNotFound sites)', () => {
    const state: BuildState = { ...initialBuildState, track: 'app', view: 'brief' }
    const restored = buildReducer(state, {
      type: 'RESTORE_BUILD',
      partial: { deepLinkNotFound: 'nope' },
    })
    expect(restored.view).toBe('brief')
    expect(restored.track).toBe('app')
  })

  it('still applies #1033\'s auto normalization (no regression)', () => {
    const restored = buildReducer(initialBuildState, {
      type: 'RESTORE_BUILD',
      partial: { track: 'company', builtCompany: true, done: { ...companyDone } },
    })
    expect(restored.auto).toBe(false)
  })

  it('every reachable RESTORE_BUILD track/view pair is coherent', () => {
    for (const track of ['app', 'company'] as const) {
      for (const startView of [...APP_VIEWS, ...COMPANY_VIEWS]) {
        const restored = buildReducer(
          { ...initialBuildState, view: startView },
          { type: 'RESTORE_BUILD', partial: { track, done: { design: 'done' } } },
        )
        expect(
          viewBelongsToTrack(restored.view, track),
          `restoring track=${track} from view=${startView} left view=${restored.view}`,
        ).toBe(true)
      }
    }
  })
})
