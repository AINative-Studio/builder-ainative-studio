import { describe, it, expect, vi } from 'vitest'
import { buildReducer, initialBuildState, type BuildState, type BuildAction, trackViews, countWoven, planUnlocks } from '@/lib/build/state'

/**
 * Tests for lib/build/useAutoplay.ts — state machine logic.
 *
 * APPROACH:
 * The hook itself (useAutoplay) drives the state machine through dispatch calls.
 * The state machine is fully captured in:
 *   - buildReducer (pure) — tested exhaustively here
 *   - trackViews (pure) — tested here
 *   - countWoven (pure) — tested here
 *   - planUnlocks (pure) — tested here
 *   - RIBBON_LINES, BUILD_VIEWS, INTERRUPT_VIEWS — structural constants
 *
 * Hook integration tests (renderHook + waitFor for guard conditions and key
 * dispatch branches) live in useAutoplay-hook.test.ts which runs in jsdom.
 *
 * This file runs in the default node environment for speed and reliability.
 */

// ── helpers ──────────────────────────────────────────────────────────────────

function wsState(overrides: Partial<BuildState> = {}): BuildState {
  return {
    ...initialBuildState,
    screen: 'ws' as const,
    auto: true,
    paused: false,
    idea: 'a brilliant idea',
    track: 'app' as const,
    view: 'brief' as const,
    askedPrivacy: true,
    ...overrides,
  }
}

// ── buildReducer — core state transitions ────────────────────────────────────

describe('buildReducer — state transitions', () => {
  it('GOTO_VIEW changes the view', () => {
    const s = buildReducer(wsState(), { type: 'GOTO_VIEW', view: 'prd' })
    expect(s.view).toBe('prd')
  })

  it('SET_OVERLAY with swarm', () => {
    const s = buildReducer(wsState(), { type: 'SET_OVERLAY', overlay: { kind: 'swarm' } })
    expect(s.overlay).toEqual({ kind: 'swarm' })
  })

  it('SET_OVERLAY with provisioning', () => {
    const s = buildReducer(wsState(), { type: 'SET_OVERLAY', overlay: { kind: 'provisioning' } })
    expect(s.overlay).toEqual({ kind: 'provisioning' })
  })

  it('SET_OVERLAY with forming', () => {
    const s = buildReducer(wsState(), { type: 'SET_OVERLAY', overlay: { kind: 'forming', view: 'brief' } })
    expect(s.overlay).toEqual({ kind: 'forming', view: 'brief' })
  })

  it('SET_OVERLAY with none clears overlay', () => {
    const s0 = { ...wsState(), overlay: { kind: 'swarm' as const } }
    const s = buildReducer(s0, { type: 'SET_OVERLAY', overlay: { kind: 'none' } })
    expect(s.overlay).toEqual({ kind: 'none' })
  })

  it('RIBBON appends a line', () => {
    const s = buildReducer(wsState(), { type: 'RIBBON', line: 'orchestrator ▸ init' })
    expect(s.ribbon).toContain('orchestrator ▸ init')
  })

  it('RIBBON keeps only the last 40 lines', () => {
    let s = wsState()
    for (let i = 0; i < 50; i++) s = buildReducer(s, { type: 'RIBBON', line: `line ${i}` })
    expect(s.ribbon.length).toBe(40)
    expect(s.ribbon[39]).toBe('line 49')
  })

  it('COMPLETE_ARTIFACT marks view as done with default status', () => {
    const s = buildReducer(wsState(), { type: 'COMPLETE_ARTIFACT', view: 'brief' })
    expect(s.done['brief']).toBe('done')
  })

  it('COMPLETE_ARTIFACT respects custom status (deployed)', () => {
    const s = buildReducer(wsState(), { type: 'COMPLETE_ARTIFACT', view: 'preview', status: 'deployed' })
    expect(s.done['preview']).toBe('deployed')
  })

  it('GEN_DONE stores content, clears error, marks done', () => {
    const content = { headline: 'My startup' }
    const s = buildReducer(
      { ...wsState(), genError: { brief: 'HTTP 500' } },
      { type: 'GEN_DONE', view: 'brief', content },
    )
    expect(s.generated['brief']).toEqual(content)
    expect(s.genError['brief']).toBe('')
    expect(s.done['brief']).toBe('done')
  })

  it('GEN_FAIL records error without touching done', () => {
    const s = buildReducer(wsState(), { type: 'GEN_FAIL', view: 'brief', error: 'Network error' })
    expect(s.genError['brief']).toBe('Network error')
    expect(s.done['brief']).toBeUndefined()
  })

  it('MVP_DONE sets builtMVP=true and building=false', () => {
    const s = buildReducer(wsState({ building: true }), { type: 'MVP_DONE' })
    expect(s.builtMVP).toBe(true)
    expect(s.building).toBe(false)
  })

  it('ASK_PRIVACY pauses with the privacy question', () => {
    const s = buildReducer(wsState(), { type: 'ASK_PRIVACY' })
    expect(s.paused).toBe(true)
    expect(s.askedPrivacy).toBe(true)
    expect(s.pendingQ?.q).toContain('data')
    expect(s.pendingQ?.opts).toHaveLength(2)
    expect(s.pendingQ?.opts[0].v).toBe('raw')
    expect(s.pendingQ?.opts[1].v).toBe('embeddings-only')
  })

  it('PICK_WEDGE sets wedgePicked', () => {
    const s = buildReducer(wsState(), { type: 'PICK_WEDGE', choice: 'eng' })
    expect(s.wedgePicked).toBe('eng')
  })

  it('TAKE_THE_WHEEL sets auto=false', () => {
    const s = buildReducer(wsState({ auto: true }), { type: 'TAKE_THE_WHEEL' })
    expect(s.auto).toBe(false)
  })

  it('KEEP_GOING sets auto=true', () => {
    const s = buildReducer(wsState({ auto: false }), { type: 'KEEP_GOING' })
    expect(s.auto).toBe(true)
  })

  it('COMPANY_DONE marks builtCompany, screen=live, building=false', () => {
    const s = buildReducer(wsState({ building: true }), { type: 'COMPANY_DONE' })
    expect(s.builtCompany).toBe(true)
    expect(s.screen).toBe('live')
    expect(s.building).toBe(false)
  })

  it('RESTORE_BUILD merges partial state', () => {
    const s = buildReducer(wsState(), {
      type: 'RESTORE_BUILD',
      partial: { idea: 'restored idea', companyName: 'Acme' },
    })
    expect(s.idea).toBe('restored idea')
    expect(s.companyName).toBe('Acme')
  })

  it('TRIGGER_CONFLICT sets screen=ws, view=conflict, auto=false', () => {
    const s = buildReducer(wsState({ auto: true }), {
      type: 'TRIGGER_CONFLICT',
      changedView: 'prd',
    })
    expect(s.screen).toBe('ws')
    expect(s.view).toBe('conflict')
    expect(s.auto).toBe(false)
    expect(s.conflictView).toBe('prd')
  })

  it('TRIGGER_CONFLICT with fromRescopeIntent routes to rescope-intent', () => {
    const s = buildReducer(wsState(), {
      type: 'TRIGGER_CONFLICT',
      changedView: 'brief',
      fromRescopeIntent: true,
    })
    expect(s.view).toBe('rescope-intent')
  })

  it('TOGGLE_RAIL opens rail and closes index', () => {
    const s = buildReducer(wsState({ indexOpen: true }), { type: 'TOGGLE_RAIL' })
    expect(s.railOpen).toBe(true)
    expect(s.indexOpen).toBe(false)
  })

  it('TOGGLE_INDEX opens index and closes rail', () => {
    const s = buildReducer(wsState({ railOpen: true }), { type: 'TOGGLE_INDEX' })
    expect(s.indexOpen).toBe(true)
    expect(s.railOpen).toBe(false)
  })

  it('SET_ACTIVE_PLAN sets activePlan and auto-enrolls business+', () => {
    const sBusiness = buildReducer(wsState(), { type: 'SET_ACTIVE_PLAN', plan: 'business' })
    expect(sBusiness.activePlan).toBe('business')
    expect(sBusiness.enrolled).toBe(true)

    const sPro = buildReducer(wsState(), { type: 'SET_ACTIVE_PLAN', plan: 'pro' })
    expect(sPro.enrolled).toBe(false)
  })

  it('SET_APP_CHATID sets appChatId', () => {
    const s = buildReducer(wsState(), { type: 'SET_APP_CHATID', chatId: 'chat-abc' })
    expect(s.appChatId).toBe('chat-abc')
  })

  it('START_BUILD clears artifacts on a new build (different appSub)', () => {
    const s0 = {
      ...wsState(),
      appSub: 'old-app',
      generated: { brief: 'old content' },
      done: { brief: 'done' },
      genError: { brief: '' },
    }
    const s = buildReducer(s0, {
      type: 'START_BUILD',
      idea: 'new idea',
      appSub: 'new-app',
    })
    expect(s.generated).toEqual({})
    expect(s.done).toEqual({})
    expect(s.idea).toBe('new idea')
    expect(s.screen).toBe('ws')
  })

  it('START_BUILD preserves artifacts on the SAME appSub (re-entry)', () => {
    const s0 = {
      ...wsState(),
      appSub: 'same-app',
      generated: { brief: 'existing content' },
      done: { brief: 'done' },
    }
    const s = buildReducer(s0, {
      type: 'START_BUILD',
      idea: 'same idea',
      appSub: 'same-app',
    })
    expect(s.generated['brief']).toBe('existing content')
    expect(s.done['brief']).toBe('done')
  })

  it('NUDGE records nudge state', () => {
    const s = buildReducer(wsState(), { type: 'NUDGE', view: 'brief', state: 'accepted' })
    expect(s.nudgeState['brief']).toBe('accepted')
  })

  it('PICK_PLAN sets plan', () => {
    const s = buildReducer(wsState(), { type: 'PICK_PLAN', plan: 'launch' })
    expect(s.plan).toBe('launch')
  })

  it('RESOLVE_CONFLICT clears propagating and marks resolved', () => {
    const s = buildReducer(wsState({ propagating: true }), { type: 'RESOLVE_CONFLICT' })
    expect(s.propagating).toBe(false)
    expect(s.conflictResolved).toBe(true)
  })

  it('ANSWER_Q clears paused and records answer', () => {
    const s0 = wsState({ paused: true })
    const s = buildReducer(s0, { type: 'ANSWER_Q', key: 'privacy', value: 'raw' })
    expect(s.paused).toBe(false)
    expect(s.answers['privacy']).toBe('raw')
    expect(s.pendingQ).toBeNull()
  })
})

// ── trackViews ────────────────────────────────────────────────────────────────

describe('trackViews — view sequence', () => {
  it('app track: 13 views, brief first, preview last, includes swarm and infra', () => {
    const views = trackViews('app')
    expect(views).toHaveLength(13)
    expect(views[0]).toBe('brief')
    expect(views[views.length - 1]).toBe('preview')
    expect(views).toContain('swarm')
    expect(views).toContain('infra')
    expect(views).toContain('dataModel')
  })

  it('company track: 6 views, thesis first, plan30 last, includes wedge', () => {
    const views = trackViews('company')
    expect(views).toHaveLength(6)
    expect(views[0]).toBe('thesis')
    expect(views[views.length - 1]).toBe('plan30')
    expect(views).toContain('wedge')
    expect(views).toContain('businessModel')
  })
})

// ── countWoven ────────────────────────────────────────────────────────────────

describe('countWoven — primitive counting', () => {
  const primitiveMap = {
    brief: { powered: ['ZeroMemory', 'GraphRAG'], nudge: { prim: 'AI Kit Safety', text: '', cta: '' } },
    prd: { powered: ['Sequential Thinking', 'ZeroMemory'], nudge: null },
  }

  it('counts unique powered primitives across done artifacts', () => {
    const state = { ...wsState(), done: { brief: 'done', prd: 'done' }, nudgeState: {} }
    // brief: ZeroMemory + GraphRAG; prd: Sequential Thinking + ZeroMemory (deduped)
    expect(countWoven(state, primitiveMap)).toBe(3)
  })

  it('adds accepted nudge primitives', () => {
    const state = {
      ...wsState(),
      done: { brief: 'done' },
      nudgeState: { brief: 'accepted' as const },
    }
    // brief powered: 2 (ZeroMemory, GraphRAG) + nudge AI Kit Safety: 3
    expect(countWoven(state, primitiveMap)).toBe(3)
  })

  it('does not count dismissed nudges', () => {
    const state = {
      ...wsState(),
      done: { brief: 'done' },
      nudgeState: { brief: 'dismissed' as const },
    }
    // Only powered (2) — dismissed nudge not counted
    expect(countWoven(state, primitiveMap)).toBe(2)
  })

  it('returns 0 when nothing is done', () => {
    const state = { ...wsState(), done: {}, nudgeState: {} }
    expect(countWoven(state, primitiveMap)).toBe(0)
  })

  it('skips views not in the primitive map', () => {
    const state = { ...wsState(), done: { unknown_view: 'done' }, nudgeState: {} }
    expect(countWoven(state, primitiveMap)).toBe(0)
  })
})

// ── planUnlocks ────────────────────────────────────────────────────────────────

describe('planUnlocks — plan gating', () => {
  it('no plan: all locked', () => {
    const u = planUnlocks('')
    expect(u.customDomain).toBe(false)
    expect(u.nightlyLoop).toBe(false)
    expect(u.swarm).toBe(false)
  })

  it('pro: customDomain only', () => {
    const u = planUnlocks('pro')
    expect(u.customDomain).toBe(true)
    expect(u.nightlyLoop).toBe(false)
    expect(u.swarm).toBe(false)
  })

  it('business: customDomain + nightlyLoop', () => {
    const u = planUnlocks('business')
    expect(u.customDomain).toBe(true)
    expect(u.nightlyLoop).toBe(true)
    expect(u.swarm).toBe(false)
  })

  it('enterprise: all unlocked', () => {
    const u = planUnlocks('enterprise')
    expect(u.customDomain).toBe(true)
    expect(u.nightlyLoop).toBe(true)
    expect(u.swarm).toBe(true)
  })

  it('cody_vcto: all unlocked (top tier)', () => {
    const u = planUnlocks('cody_vcto')
    expect(u.customDomain).toBe(true)
    expect(u.nightlyLoop).toBe(true)
    expect(u.swarm).toBe(true)
  })
})

// ── initialBuildState sanity ──────────────────────────────────────────────────

describe('initialBuildState', () => {
  it('starts at fork screen with auto=true', () => {
    expect(initialBuildState.screen).toBe('fork')
    expect(initialBuildState.auto).toBe(true)
    expect(initialBuildState.paused).toBe(false)
    expect(initialBuildState.idea).toBe('')
    expect(initialBuildState.builtMVP).toBe(false)
    expect(initialBuildState.builtCompany).toBe(false)
    expect(initialBuildState.overlay).toEqual({ kind: 'none' })
    expect(initialBuildState.ribbon).toHaveLength(0)
    expect(initialBuildState.activePlan).toBe('')
  })
})
