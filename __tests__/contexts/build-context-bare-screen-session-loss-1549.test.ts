import { describe, it, expect } from 'vitest'
import { isUnresumableBareScreenDeepLink, shouldResumeFromPointer } from '@/contexts/build-context'

/**
 * builder#1549 — "navigating to /build?screen=ws (or ?screen=ws&view=X)
 * without an explicit ?company= silently discards an in-progress build
 * session and starts a brand-new, blank one."
 *
 * Root cause, traced through contexts/build-context.tsx: the deep-link
 * mount effect treated ANY recognized ?screen= value (including company-
 * scoped ones like 'ws'/'live') as a complete destination and unconditionally
 * dispatched GOTO_SCREEN(scr) even with no `company` param to restore from.
 * That synchronous dispatch commits state.screen to 'ws' in the same mount
 * pass, before the #669 resume-pointer effect's `state.screen !== 'landing'`
 * guard is even evaluated — so a real, resumable in-progress build (tracked
 * via the localStorage active-build pointer) never gets a chance to resume.
 *
 * Fix: isUnresumableBareScreenDeepLink identifies exactly this case — a
 * KNOWN_DEEP_LINK_SCREENS value that needs a `company` to mean anything
 * (i.e. NOT in SCREENS_WITHOUT_COMPANY_CONTEXT) with no `company` present —
 * and the mount effect now declines to dispatch GOTO_SCREEN for it,
 * leaving state.screen at 'landing' so the resume-pointer effect can run.
 */
describe('isUnresumableBareScreenDeepLink (#1549)', () => {
  it('fires for the reported repro: a bare ?screen=ws with no company', () => {
    expect(isUnresumableBareScreenDeepLink('?screen=ws')).toBe(true)
  })

  it('fires the same way with an accompanying ?view= param', () => {
    expect(isUnresumableBareScreenDeepLink('?screen=ws&view=preview')).toBe(true)
  })

  it('fires for every other company-scoped screen, not just ws', () => {
    for (const screen of ['live', 'intake', 'kickoff', 'fork', 'build', 'pricing']) {
      expect(isUnresumableBareScreenDeepLink(`?screen=${screen}`)).toBe(true)
    }
  })

  it('does NOT fire once a real company param is present — the normal deep link', () => {
    expect(isUnresumableBareScreenDeepLink('?screen=ws&company=morphic')).toBe(false)
  })

  it('does NOT fire for a company-context-free screen — isExplicitScreenOnlyDeepLink already protects those', () => {
    for (const screen of ['companies', 'account', 'login', 'signup', 'forgot', 'reset', 'refer', 'start']) {
      expect(isUnresumableBareScreenDeepLink(`?screen=${screen}`)).toBe(false)
    }
  })

  it('does not fire for an unknown screen', () => {
    expect(isUnresumableBareScreenDeepLink('?screen=nonsense')).toBe(false)
  })

  it('does not fire with no screen param at all', () => {
    expect(isUnresumableBareScreenDeepLink('')).toBe(false)
    expect(isUnresumableBareScreenDeepLink('?utm_source=email')).toBe(false)
  })
})

describe('shouldResumeFromPointer — a real in-progress build survives a bare ?screen=ws nav (#1549)', () => {
  const session = { user: { email: 'founder@ainative.studio' } }
  const pointer = { slug: 'pipewrench', screen: 'ws' }
  const saved = { builtCompany: false, appChatId: 'chat-pipewrench', track: 'app' }

  it('resumes when state.screen is still landing (the fixed mount-effect behavior)', () => {
    expect(shouldResumeFromPointer({
      search: '?screen=ws', pointer, saved, session,
      current: { screen: 'landing', appSub: '', idea: '' },
    })).toBe(true)
  })

  it('resumes the same way for ?screen=ws&view=preview', () => {
    expect(shouldResumeFromPointer({
      search: '?screen=ws&view=preview', pointer, saved, session,
      current: { screen: 'landing', appSub: '', idea: '' },
    })).toBe(true)
  })
})
