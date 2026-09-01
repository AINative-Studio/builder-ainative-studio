import { describe, it, expect } from 'vitest'
import {
  buildReducer,
  trackViews,
  planUnlocks,
  countWoven,
  initialBuildState,
  APP_VIEWS,
  COMPANY_VIEWS,
  type BuildState,
  type BuildAction,
  type ActivePlan,
} from '@/lib/build/state'

/**
 * lib/build/state — builder pivot state machine (#220).
 * Pure logic — no I/O, no mocks. Covers the reducer (all action types),
 * trackViews, planUnlocks (all tiers), and countWoven.
 */

// Helper: apply a sequence of actions from initial state
function applyActions(actions: BuildAction[], initial: BuildState = initialBuildState): BuildState {
  return actions.reduce((s, a) => buildReducer(s, a), initial)
}

describe('initialBuildState', () => {
  it('has the expected defaults', () => {
    const s = initialBuildState
    // Public marketing landing is the front door (Claude Design handoff); the
    // context redirects signed-in visitors past it to their builds.
    expect(s.screen).toBe('landing')
    expect(s.track).toBe('app')
    expect(s.view).toBe('brief')
    expect(s.plan).toBe('')
    expect(s.auto).toBe(true)
    expect(s.building).toBe(false)
    expect(s.paused).toBe(false)
    expect(s.activePlan).toBe('')
    expect(s.enrolled).toBe(false)
    expect(s.overlay).toEqual({ kind: 'none' })
  })
})

describe('buildReducer — GOTO_SCREEN', () => {
  it('changes screen to the given value', () => {
    const s = buildReducer(initialBuildState, { type: 'GOTO_SCREEN', screen: 'pricing' })
    expect(s.screen).toBe('pricing')
  })

  it('does not mutate other state fields', () => {
    const prev = { ...initialBuildState, track: 'company' as const }
    const next = buildReducer(prev, { type: 'GOTO_SCREEN', screen: 'account' })
    expect(next.track).toBe('company')
    expect(next.screen).toBe('account')
  })
})

describe('landing funnel (Claude Design handoff)', () => {
  it('landing → start → build are all reachable screens via GOTO_SCREEN', () => {
    for (const screen of ['landing', 'start', 'build'] as const) {
      const s = buildReducer(initialBuildState, { type: 'GOTO_SCREEN', screen })
      expect(s.screen).toBe(screen)
    }
  })

  it('SET_IDEA seeds the idea field without starting a build ("Surprise me")', () => {
    const seeded = 'An AI answer engine that replies from your own docs.'
    const s = buildReducer(initialBuildState, { type: 'SET_IDEA', idea: seeded })
    expect(s.idea).toBe(seeded)
    // Seeding must NOT navigate or start building — the founder still edits in Intake.
    expect(s.screen).toBe(initialBuildState.screen)
    expect(s.building).toBe(false)
  })

  it('SET_IDEA does not clobber unrelated state', () => {
    const prev = { ...initialBuildState, track: 'company' as const, companyName: 'Acme' }
    const s = buildReducer(prev, { type: 'SET_IDEA', idea: 'x' })
    expect(s.track).toBe('company')
    expect(s.companyName).toBe('Acme')
  })

  it('full funnel: landing → start → build → PICK_TRACK(company) lands on intake', () => {
    const s = applyActions([
      { type: 'GOTO_SCREEN', screen: 'start' },
      { type: 'GOTO_SCREEN', screen: 'build' },
      { type: 'SET_IDEA', idea: 'seeded surprise idea' },
      { type: 'PICK_TRACK', track: 'company' },
    ])
    expect(s.screen).toBe('intake')
    expect(s.track).toBe('company')
    expect(s.idea).toBe('seeded surprise idea') // seed survives into intake
  })
})

describe('buildReducer — PICK_TRACK', () => {
  it('sets track to app and view to brief, navigates to intake', () => {
    const s = buildReducer(initialBuildState, { type: 'PICK_TRACK', track: 'app' })
    expect(s.track).toBe('app')
    expect(s.view).toBe('brief')
    expect(s.screen).toBe('intake')
  })

  it('sets track to company and view to thesis, navigates to intake', () => {
    const s = buildReducer(initialBuildState, { type: 'PICK_TRACK', track: 'company' })
    expect(s.track).toBe('company')
    expect(s.view).toBe('thesis')
    expect(s.screen).toBe('intake')
  })

  describe('#448 — company role (marketing/sales/operations)', () => {
    it('defaults role to "" (no change to existing behavior when unspecified)', () => {
      const s = buildReducer(initialBuildState, { type: 'PICK_TRACK', track: 'company' })
      expect(s.role).toBe('')
    })

    it('stores a role when picking the company track', () => {
      const s = buildReducer(initialBuildState, { type: 'PICK_TRACK', track: 'company', role: 'sales' })
      expect(s.role).toBe('sales')
    })

    it('clears any stale role when picking the app track', () => {
      const withRole = buildReducer(initialBuildState, { type: 'PICK_TRACK', track: 'company', role: 'marketing' })
      const s = buildReducer(withRole, { type: 'PICK_TRACK', track: 'app' })
      expect(s.role).toBe('')
    })

    it('a company pick with no role keeps a previously-set role (re-entering intake)', () => {
      const withRole = buildReducer(initialBuildState, { type: 'PICK_TRACK', track: 'company', role: 'operations' })
      const s = buildReducer(withRole, { type: 'PICK_TRACK', track: 'company' })
      expect(s.role).toBe('operations')
    })
  })
})

describe('buildReducer — START_BUILD', () => {
  it('clears generated/done/genError for a new build (different appSub)', () => {
    const prev: BuildState = {
      ...initialBuildState,
      appSub: 'old-sub',
      generated: { brief: 'existing' },
      done: { brief: 'done' },
      genError: { brief: 'err' },
    }
    const s = buildReducer(prev, {
      type: 'START_BUILD',
      idea: 'New idea',
      appSub: 'new-sub',
      companyName: 'New Co',
    })
    expect(s.screen).toBe('ws')
    expect(s.idea).toBe('New idea')
    expect(s.appSub).toBe('new-sub')
    expect(s.generated).toEqual({})
    expect(s.done).toEqual({})
    expect(s.genError).toEqual({})
    expect(s.building).toBe(true)
    expect(s.auto).toBe(true)
  })

  it('preserves generated/done when re-entering the SAME company (same appSub, #284)', () => {
    const prev: BuildState = {
      ...initialBuildState,
      appSub: 'same-sub',
      generated: { brief: 'existing content' },
      done: { brief: 'done' },
    }
    const s = buildReducer(prev, {
      type: 'START_BUILD',
      idea: 'Updated idea',
      appSub: 'same-sub',
    })
    expect(s.generated).toEqual({ brief: 'existing content' })
    expect(s.done).toEqual({ brief: 'done' })
  })

  it('clears generated when appSub was empty before', () => {
    const prev: BuildState = {
      ...initialBuildState,
      appSub: '',
      generated: { brief: 'old' },
    }
    const s = buildReducer(prev, { type: 'START_BUILD', idea: 'x', appSub: 'new-sub' })
    expect(s.generated).toEqual({})
  })

  it('uses existing companyName/brandTagline/brandColor when not provided in action', () => {
    const prev: BuildState = {
      ...initialBuildState,
      companyName: 'Existing Co',
      brandTagline: 'Existing tagline',
      brandColor: '#ff0000',
    }
    const s = buildReducer(prev, { type: 'START_BUILD', idea: 'x', appSub: 'new' })
    expect(s.companyName).toBe('Existing Co')
    expect(s.brandTagline).toBe('Existing tagline')
    expect(s.brandColor).toBe('#ff0000')
  })

  it('sets view to brief for app track, thesis for company track', () => {
    const appState = buildReducer({ ...initialBuildState, track: 'app' }, { type: 'START_BUILD', idea: 'x', appSub: 'x' })
    expect(appState.view).toBe('brief')

    const compState = buildReducer({ ...initialBuildState, track: 'company' }, { type: 'START_BUILD', idea: 'x', appSub: 'x' })
    expect(compState.view).toBe('thesis')
  })
})

describe('buildReducer — GEN_DONE', () => {
  it('stores content in generated, clears genError, marks done', () => {
    const s = buildReducer(initialBuildState, {
      type: 'GEN_DONE',
      view: 'brief',
      content: { markdown: 'Here is the brief' },
    })
    expect(s.generated.brief).toEqual({ markdown: 'Here is the brief' })
    expect(s.genError.brief).toBe('')
    expect(s.done.brief).toBe('done')
  })

  it('accumulates multiple GEN_DONE actions without overwriting others', () => {
    const s = applyActions([
      { type: 'GEN_DONE', view: 'brief', content: 'brief-content' },
      { type: 'GEN_DONE', view: 'prd', content: 'prd-content' },
    ])
    expect(s.generated.brief).toBe('brief-content')
    expect(s.generated.prd).toBe('prd-content')
  })
})

describe('buildReducer — GEN_FAIL', () => {
  it('stores the error in genError without touching generated or done', () => {
    const prev: BuildState = {
      ...initialBuildState,
      generated: { brief: 'existing' },
      done: { brief: 'done' },
    }
    const s = buildReducer(prev, { type: 'GEN_FAIL', view: 'brief', error: 'Timeout' })
    expect(s.genError.brief).toBe('Timeout')
    expect(s.generated.brief).toBe('existing') // unchanged
    expect(s.done.brief).toBe('done') // unchanged
  })
})

describe('buildReducer — GOTO_VIEW', () => {
  it('changes view to the given artifact', () => {
    const s = buildReducer(initialBuildState, { type: 'GOTO_VIEW', view: 'prd' })
    expect(s.view).toBe('prd')
  })
})

describe('buildReducer — SET_BUILDING', () => {
  it('sets building flag', () => {
    const s1 = buildReducer(initialBuildState, { type: 'SET_BUILDING', building: true })
    expect(s1.building).toBe(true)
    const s2 = buildReducer(s1, { type: 'SET_BUILDING', building: false })
    expect(s2.building).toBe(false)
  })
})

describe('buildReducer — COMPLETE_ARTIFACT', () => {
  it('marks an artifact done with default status "done"', () => {
    const s = buildReducer(initialBuildState, { type: 'COMPLETE_ARTIFACT', view: 'brief' })
    expect(s.done.brief).toBe('done')
  })

  it('uses the provided status string when given', () => {
    const s = buildReducer(initialBuildState, { type: 'COMPLETE_ARTIFACT', view: 'prd', status: 'partial' })
    expect(s.done.prd).toBe('partial')
  })
})

describe('buildReducer — PAUSE / ANSWER_Q', () => {
  it('PAUSE sets paused=true and stores the pendingQ', () => {
    const q = { q: 'Pick one', sub: 'sub', opts: [{ v: 'a', t: 'Option A' }] }
    const s = buildReducer(initialBuildState, { type: 'PAUSE', pendingQ: q })
    expect(s.paused).toBe(true)
    expect(s.pendingQ).toEqual(q)
  })

  it('ANSWER_Q clears paused, clears pendingQ, stores answer', () => {
    const paused = { ...initialBuildState, paused: true, pendingQ: { q: 'x', sub: '', opts: [] } }
    const s = buildReducer(paused, { type: 'ANSWER_Q', key: 'privacy', value: 'raw' })
    expect(s.paused).toBe(false)
    expect(s.pendingQ).toBeNull()
    expect(s.answers.privacy).toBe('raw')
  })

  it('ANSWER_Q accumulates multiple answers', () => {
    const s = applyActions([
      { type: 'PAUSE', pendingQ: { q: 'q1', sub: '', opts: [] } },
      { type: 'ANSWER_Q', key: 'privacy', value: 'raw' },
      { type: 'PAUSE', pendingQ: { q: 'q2', sub: '', opts: [] } },
      { type: 'ANSWER_Q', key: 'another', value: 'embeddings-only' },
    ])
    expect(s.answers.privacy).toBe('raw')
    expect(s.answers.another).toBe('embeddings-only')
  })
})

describe('buildReducer — TAKE_THE_WHEEL / KEEP_GOING', () => {
  it('TAKE_THE_WHEEL sets auto=false', () => {
    const s = buildReducer({ ...initialBuildState, auto: true }, { type: 'TAKE_THE_WHEEL' })
    expect(s.auto).toBe(false)
  })

  it('KEEP_GOING sets auto=true', () => {
    const s = buildReducer({ ...initialBuildState, auto: false }, { type: 'KEEP_GOING' })
    expect(s.auto).toBe(true)
  })
})

describe('buildReducer — NUDGE', () => {
  it('stores nudge state for a view', () => {
    const s = buildReducer(initialBuildState, { type: 'NUDGE', view: 'brief', state: 'accepted' })
    expect(s.nudgeState.brief).toBe('accepted')
  })

  it('stores dismissed nudge state', () => {
    const s = buildReducer(initialBuildState, { type: 'NUDGE', view: 'prd', state: 'dismissed' })
    expect(s.nudgeState.prd).toBe('dismissed')
  })
})

describe('buildReducer — PICK_WEDGE', () => {
  it('sets wedgePicked', () => {
    const s = buildReducer(initialBuildState, { type: 'PICK_WEDGE', choice: 'eng' })
    expect(s.wedgePicked).toBe('eng')
  })
})

describe('buildReducer — MVP_DONE / COMPANY_DONE', () => {
  it('MVP_DONE sets builtMVP=true and building=false', () => {
    const s = buildReducer({ ...initialBuildState, building: true }, { type: 'MVP_DONE' })
    expect(s.builtMVP).toBe(true)
    expect(s.building).toBe(false)
  })

  it('COMPANY_DONE sets builtCompany=true, building=false, screen=live', () => {
    const s = buildReducer({ ...initialBuildState, building: true }, { type: 'COMPANY_DONE' })
    expect(s.builtCompany).toBe(true)
    expect(s.building).toBe(false)
    expect(s.screen).toBe('live')
  })

  // #398: autoplay's live walk-through leaves `view` on the LAST artifact
  // (plan30) once generation finishes — COMPANY_DONE must reset it to the
  // FIRST artifact (thesis) so re-entering the workspace lands the founder
  // at the top of the artifacts list, not the bottom.
  it('COMPANY_DONE resets view to the first company-track artifact (thesis), regardless of where autoplay left it', () => {
    const s = buildReducer(
      { ...initialBuildState, track: 'company', building: true, view: 'plan30' },
      { type: 'COMPANY_DONE' },
    )
    expect(s.view).toBe('thesis')
  })
})

describe('buildReducer — PICK_PLAN', () => {
  it('sets plan field', () => {
    const s = buildReducer(initialBuildState, { type: 'PICK_PLAN', plan: 'launch' })
    expect(s.plan).toBe('launch')
  })
})

describe('buildReducer — SET_PROPAGATING / RESOLVE_CONFLICT', () => {
  it('SET_PROPAGATING sets the propagating flag', () => {
    const s = buildReducer(initialBuildState, { type: 'SET_PROPAGATING', propagating: true })
    expect(s.propagating).toBe(true)
  })

  it('RESOLVE_CONFLICT clears propagating and sets conflictResolved', () => {
    const s = buildReducer(
      { ...initialBuildState, propagating: true, conflictResolved: false },
      { type: 'RESOLVE_CONFLICT' },
    )
    expect(s.propagating).toBe(false)
    expect(s.conflictResolved).toBe(true)
  })
})

describe('buildReducer — TRIGGER_CONFLICT', () => {
  it('routes to conflict view by default', () => {
    const s = buildReducer(initialBuildState, { type: 'TRIGGER_CONFLICT', changedView: 'prd' })
    expect(s.view).toBe('conflict')
    expect(s.conflictView).toBe('prd')
    expect(s.conflictResolved).toBe(false)
    expect(s.auto).toBe(false)
    expect(s.screen).toBe('ws')
    expect(s.overlay).toEqual({ kind: 'none' })
  })

  it('routes to rescope-intent first when fromRescopeIntent=true', () => {
    const s = buildReducer(initialBuildState, {
      type: 'TRIGGER_CONFLICT',
      changedView: 'brief',
      fromRescopeIntent: true,
    })
    expect(s.view).toBe('rescope-intent')
    expect(s.conflictView).toBe('brief')
  })
})

describe('buildReducer — RESTORE_BUILD', () => {
  it('merges partial state without disturbing other fields', () => {
    const s = buildReducer(initialBuildState, {
      type: 'RESTORE_BUILD',
      partial: {
        idea: 'Restored idea',
        appSub: 'restored-sub',
        activePlan: 'pro',
        enrolled: true,
      },
    })
    expect(s.idea).toBe('Restored idea')
    expect(s.appSub).toBe('restored-sub')
    expect(s.activePlan).toBe('pro')
    expect(s.enrolled).toBe(true)
    expect(s.screen).toBe('landing') // unchanged (RESTORE_BUILD never navigates)
  })
})

describe('buildReducer — SET_TABLET', () => {
  it('sets tablet flag', () => {
    const s = buildReducer(initialBuildState, { type: 'SET_TABLET', tablet: true })
    expect(s.tablet).toBe(true)
  })
})

describe('buildReducer — TOGGLE_RAIL / TOGGLE_INDEX', () => {
  it('TOGGLE_RAIL toggles railOpen and closes indexOpen', () => {
    const s1 = buildReducer({ ...initialBuildState, indexOpen: true }, { type: 'TOGGLE_RAIL' })
    expect(s1.railOpen).toBe(true)
    expect(s1.indexOpen).toBe(false)
    const s2 = buildReducer(s1, { type: 'TOGGLE_RAIL' })
    expect(s2.railOpen).toBe(false)
  })

  it('TOGGLE_INDEX toggles indexOpen and closes railOpen', () => {
    const s1 = buildReducer({ ...initialBuildState, railOpen: true }, { type: 'TOGGLE_INDEX' })
    expect(s1.indexOpen).toBe(true)
    expect(s1.railOpen).toBe(false)
    const s2 = buildReducer(s1, { type: 'TOGGLE_INDEX' })
    expect(s2.indexOpen).toBe(false)
  })
})

describe('buildReducer — SET_APP_CHATID', () => {
  it('sets appChatId', () => {
    const s = buildReducer(initialBuildState, { type: 'SET_APP_CHATID', chatId: 'chat-xyz' })
    expect(s.appChatId).toBe('chat-xyz')
  })
})

describe('buildReducer — SAW_PREVIEW (#310/#311 value moment)', () => {
  it('defaults to false and flips true on SAW_PREVIEW', () => {
    expect(initialBuildState.sawPreview).toBe(false)
    const s = buildReducer(initialBuildState, { type: 'SAW_PREVIEW' })
    expect(s.sawPreview).toBe(true)
  })

  it('is one-way: a NEW build does not un-see the value moment', () => {
    const seen = buildReducer(initialBuildState, { type: 'SAW_PREVIEW' })
    const s = buildReducer(seen, {
      type: 'START_BUILD', idea: 'a fresh idea', appSub: 'fresh-co',
    })
    expect(s.sawPreview).toBe(true)
  })

  it('restores via RESTORE_BUILD (persisted per founder journey)', () => {
    const s = buildReducer(initialBuildState, {
      type: 'RESTORE_BUILD', partial: { sawPreview: true },
    })
    expect(s.sawPreview).toBe(true)
  })
})

describe('buildReducer — SET_ACTIVE_PLAN', () => {
  it('sets activePlan to pro and auto-enrolls based on tier', () => {
    const s = buildReducer(initialBuildState, { type: 'SET_ACTIVE_PLAN', plan: 'pro' })
    expect(s.activePlan).toBe('pro')
    expect(s.enrolled).toBe(false) // pro does NOT auto-enroll
  })

  it('auto-enrolls on business tier', () => {
    const s = buildReducer(initialBuildState, { type: 'SET_ACTIVE_PLAN', plan: 'business' })
    expect(s.activePlan).toBe('business')
    expect(s.enrolled).toBe(true)
  })

  it('auto-enrolls on enterprise tier', () => {
    const s = buildReducer(initialBuildState, { type: 'SET_ACTIVE_PLAN', plan: 'enterprise' })
    expect(s.enrolled).toBe(true)
  })

  it('auto-enrolls on cody_vcto tier', () => {
    const s = buildReducer(initialBuildState, { type: 'SET_ACTIVE_PLAN', plan: 'cody_vcto' })
    expect(s.enrolled).toBe(true)
  })

  it('respects explicit enrolled override when provided', () => {
    const s = buildReducer(initialBuildState, { type: 'SET_ACTIVE_PLAN', plan: 'business', enrolled: false })
    expect(s.enrolled).toBe(false)
  })

  it('sets empty plan and no enrollment for no subscription', () => {
    const s = buildReducer({ ...initialBuildState, enrolled: true }, { type: 'SET_ACTIVE_PLAN', plan: '' })
    expect(s.activePlan).toBe('')
    expect(s.enrolled).toBe(false)
  })
})

describe('buildReducer — SET_OVERLAY', () => {
  it('sets the overlay', () => {
    const s = buildReducer(initialBuildState, { type: 'SET_OVERLAY', overlay: { kind: 'swarm' } })
    expect(s.overlay).toEqual({ kind: 'swarm' })
  })

  it('sets forming overlay with view', () => {
    const s = buildReducer(initialBuildState, { type: 'SET_OVERLAY', overlay: { kind: 'forming', view: 'brief' } })
    expect(s.overlay).toEqual({ kind: 'forming', view: 'brief' })
  })

  it('clears overlay back to none', () => {
    const s = buildReducer(
      { ...initialBuildState, overlay: { kind: 'swarm' } },
      { type: 'SET_OVERLAY', overlay: { kind: 'none' } },
    )
    expect(s.overlay).toEqual({ kind: 'none' })
  })
})

describe('buildReducer — RIBBON', () => {
  it('appends a line to the ribbon', () => {
    const s = buildReducer(initialBuildState, { type: 'RIBBON', line: 'Deploying...' })
    expect(s.ribbon).toContain('Deploying...')
  })

  it('keeps the last 40 lines (trims oldest)', () => {
    const actions: BuildAction[] = Array.from({ length: 50 }, (_, i) => ({ type: 'RIBBON' as const, line: `line-${i}` }))
    const s = applyActions(actions)
    expect(s.ribbon).toHaveLength(40)
    expect(s.ribbon[0]).toBe('line-10') // first 10 trimmed, starts at line-10
    expect(s.ribbon[39]).toBe('line-49')
  })
})

describe('buildReducer — ASK_PRIVACY', () => {
  it('pauses, marks askedPrivacy, sets the privacy pendingQ', () => {
    const s = buildReducer(initialBuildState, { type: 'ASK_PRIVACY' })
    expect(s.paused).toBe(true)
    expect(s.askedPrivacy).toBe(true)
    expect(s.pendingQ).not.toBeNull()
    expect(s.pendingQ!.q).toContain('How should your data be stored')
    expect(s.pendingQ!.opts).toHaveLength(2)
    expect(s.pendingQ!.opts[0].v).toBe('raw')
    expect(s.pendingQ!.opts[1].v).toBe('embeddings-only')
  })
})

describe('buildReducer — default (unknown action)', () => {
  it('returns the existing state unchanged for an unknown action type', () => {
    const state = { ...initialBuildState, idea: 'existing' }
    const next = buildReducer(state, { type: 'UNKNOWN_ACTION' } as unknown as BuildAction)
    expect(next).toEqual(state)
  })
})

describe('buildReducer — immutability', () => {
  it('never mutates the input state object', () => {
    const s = { ...initialBuildState }
    const frozen = Object.freeze(s)
    // Should not throw since reducers spread into a new object
    expect(() => buildReducer(frozen, { type: 'GOTO_SCREEN', screen: 'pricing' })).not.toThrow()
  })
})

// ---------- trackViews ----------
describe('trackViews', () => {
  it('returns APP_VIEWS for app track', () => {
    expect(trackViews('app')).toBe(APP_VIEWS)
  })

  it('returns COMPANY_VIEWS for company track', () => {
    expect(trackViews('company')).toBe(COMPANY_VIEWS)
  })

  it('APP_VIEWS contains expected artifact ids', () => {
    expect(APP_VIEWS).toContain('brief')
    expect(APP_VIEWS).toContain('prd')
    expect(APP_VIEWS).toContain('preview')
    expect(APP_VIEWS).toContain('swarm')
  })

  it('COMPANY_VIEWS contains expected artifact ids', () => {
    expect(COMPANY_VIEWS).toContain('thesis')
    expect(COMPANY_VIEWS).toContain('landing')
    expect(COMPANY_VIEWS).toContain('plan30')
  })
})

// ---------- planUnlocks ----------
describe('planUnlocks', () => {
  it('returns all false for no plan', () => {
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

  it('enterprise: all three unlocked', () => {
    const u = planUnlocks('enterprise')
    expect(u.customDomain).toBe(true)
    expect(u.nightlyLoop).toBe(true)
    expect(u.swarm).toBe(true)
  })

  it('cody_vcto: all three unlocked (top tier)', () => {
    const u = planUnlocks('cody_vcto')
    expect(u.customDomain).toBe(true)
    expect(u.nightlyLoop).toBe(true)
    expect(u.swarm).toBe(true)
  })

  it('tiers are cumulative — enterprise has everything business has', () => {
    const biz = planUnlocks('business')
    const ent = planUnlocks('enterprise')
    for (const key of Object.keys(biz) as (keyof typeof biz)[]) {
      if (biz[key]) expect(ent[key]).toBe(true)
    }
  })
})

// ---------- countWoven ----------
describe('countWoven', () => {
  const primitiveMap = {
    brief: { powered: ['ZeroDB', 'ZeroMemory'], nudge: null },
    prd: { powered: ['ZeroDB', 'ZeroVoice'], nudge: { prim: 'ZeroVoice' } },
    swarm: { powered: ['AgentCloud'], nudge: null },
    preview: { powered: [], nudge: { prim: 'Railway' } },
  }

  it('returns 0 when nothing is done or nudged', () => {
    expect(countWoven(initialBuildState, primitiveMap)).toBe(0)
  })

  it('counts distinct primitives from completed artifacts', () => {
    const state: BuildState = {
      ...initialBuildState,
      done: { brief: 'done', prd: 'done' },
    }
    // brief: ZeroDB + ZeroMemory; prd: ZeroDB + ZeroVoice → 3 distinct
    expect(countWoven(state, primitiveMap)).toBe(3)
  })

  it('deduplicates primitives across artifacts', () => {
    const state: BuildState = {
      ...initialBuildState,
      done: { brief: 'done', prd: 'done', swarm: 'done' },
    }
    // ZeroDB (x2), ZeroMemory, ZeroVoice, AgentCloud = 4 distinct
    expect(countWoven(state, primitiveMap)).toBe(4)
  })

  it('counts accepted nudge primitives', () => {
    const state: BuildState = {
      ...initialBuildState,
      nudgeState: { preview: 'accepted' },
    }
    // preview nudge adds Railway
    expect(countWoven(state, primitiveMap)).toBe(1)
  })

  it('does not count dismissed nudge primitives', () => {
    const state: BuildState = {
      ...initialBuildState,
      nudgeState: { preview: 'dismissed' },
    }
    expect(countWoven(state, primitiveMap)).toBe(0)
  })

  it('combines done artifacts + accepted nudges, deduplicating', () => {
    const state: BuildState = {
      ...initialBuildState,
      done: { prd: 'done' }, // ZeroDB, ZeroVoice
      nudgeState: { prd: 'accepted' }, // prd nudge = ZeroVoice (already counted)
    }
    // prd powered: ZeroDB + ZeroVoice = 2; prd nudge: ZeroVoice (dup) → still 2
    expect(countWoven(state, primitiveMap)).toBe(2)
  })

  it('ignores unknown artifact ids in done or nudgeState', () => {
    const state: BuildState = {
      ...initialBuildState,
      done: { unknown_view: 'done' },
      nudgeState: { also_unknown: 'accepted' },
    }
    expect(countWoven(state, primitiveMap)).toBe(0)
  })

  it('handles empty primitiveMap', () => {
    const state: BuildState = { ...initialBuildState, done: { brief: 'done' } }
    expect(countWoven(state, {})).toBe(0)
  })
})

describe('buildReducer — SET_COMPANY_NAME (#396)', () => {
  it('sets a trimmed company name', () => {
    const prev: BuildState = { ...initialBuildState, companyName: 'Old Name' }
    const s = buildReducer(prev, { type: 'SET_COMPANY_NAME', companyName: '  New Name  ' })
    expect(s.companyName).toBe('New Name')
  })

  it('ignores a blank/whitespace-only name — never clears companyName to empty', () => {
    const prev: BuildState = { ...initialBuildState, companyName: 'Keep Me' }
    const s = buildReducer(prev, { type: 'SET_COMPANY_NAME', companyName: '   ' })
    expect(s.companyName).toBe('Keep Me')
  })

  it('does not affect any other state field', () => {
    const prev: BuildState = { ...initialBuildState, companyName: 'A', idea: 'an idea', track: 'company' }
    const s = buildReducer(prev, { type: 'SET_COMPANY_NAME', companyName: 'B' })
    expect(s.idea).toBe('an idea')
    expect(s.track).toBe('company')
  })
})
