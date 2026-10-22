import { describe, it, expect } from 'vitest'
import { isExplicitScreenOnlyDeepLink, shouldResumeFromPointer } from '@/contexts/build-context'

/**
 * builder#1254 — "no way to navigate from an active workspace back to the
 * companies list ... navigating directly to /build?screen=companies while
 * inside an active workspace does NOT load the companies list — it silently
 * redirects back into the active workspace session instead."
 *
 * Root cause, traced through contexts/build-context.tsx: the #669 resume-
 * pointer effect defers to isExplicitCompanyDeepLink(search), which requires
 * BOTH a `screen` AND a `company` query param before treating the URL as an
 * explicit, protected destination (by design, per its own doc comment — a
 * company-scoped screen like `ws`/`live` with no `company` really doesn't
 * name anything worth protecting). `/build?screen=companies` has `screen`
 * but no `company`, so it was indistinguishable from a genuinely bare
 * `/build` reload — exactly the case #669's resume effect exists to serve.
 * With a stale localStorage pointer for the workspace the founder just left
 * (saveActiveBuild persists on every screen outside `noResumeScreens`, which
 * includes `ws`), the resume effect's async getSession() resolves ~1-2s
 * later and dispatches GOTO_SCREEN back onto the OLD workspace screen —
 * overriding the deep-link effect's own, already-committed
 * GOTO_SCREEN('companies'). From the founder's side: clicking through to My
 * companies "does nothing" (it flashes, then bounces back).
 *
 * Fix: isExplicitScreenOnlyDeepLink recognizes a bare ?screen=<x> as an
 * explicit destination when <x> is one of SCREENS_WITHOUT_COMPANY_CONTEXT
 * (companies, account, login, …) — a screen where a `company` param could
 * never apply in the first place, so the screen name alone is the complete
 * destination. shouldResumeFromPointer now defers to it the same way it
 * already defers to isExplicitCompanyDeepLink.
 */
describe('isExplicitScreenOnlyDeepLink (#1254)', () => {
  it('recognizes a bare ?screen=companies as explicit — the reported bounce path', () => {
    expect(isExplicitScreenOnlyDeepLink('?screen=companies')).toBe(true)
  })

  it('recognizes every company-context-free screen the same way', () => {
    for (const screen of ['account', 'login', 'signup', 'forgot', 'reset', 'refer', 'start']) {
      expect(isExplicitScreenOnlyDeepLink(`?screen=${screen}`)).toBe(true)
    }
  })

  it('does NOT fire for a company-scoped screen with no company param — unchanged behavior', () => {
    // ws/live/intake/etc. genuinely don't name a destination without a slug;
    // isExplicitCompanyDeepLink already (correctly) declines these, and this
    // sibling check must not start protecting them either.
    for (const screen of ['ws', 'live', 'intake', 'kickoff', 'fork', 'build', 'pricing']) {
      expect(isExplicitScreenOnlyDeepLink(`?screen=${screen}`)).toBe(false)
    }
  })

  it('does not fire for an unknown screen', () => {
    expect(isExplicitScreenOnlyDeepLink('?screen=nonsense')).toBe(false)
  })

  it('does not fire with no screen param at all (a genuinely bare reload)', () => {
    expect(isExplicitScreenOnlyDeepLink('')).toBe(false)
    expect(isExplicitScreenOnlyDeepLink('?utm_source=email')).toBe(false)
  })

  it('still fires when a company param is ALSO present (superset, not exclusive)', () => {
    expect(isExplicitScreenOnlyDeepLink('?screen=companies&company=silo')).toBe(true)
  })
})

describe('shouldResumeFromPointer — defers to a bare ?screen=companies (#1254)', () => {
  const session = { user: { email: 'founder@ainative.studio' } }
  // The stale pointer left behind by the workspace the founder just left —
  // saveActiveBuild persists on every screen outside noResumeScreens, which
  // includes 'ws'.
  const pointer = { slug: 'morphic', screen: 'ws' }
  const saved = { builtCompany: false, appChatId: 'chat-morphic', track: 'app' }

  it('REFUSES to resume over an explicit ?screen=companies navigation — the reported bounce', () => {
    expect(shouldResumeFromPointer({
      search: '?screen=companies', pointer, saved, session,
    })).toBe(false)
  })

  it('REFUSES even when `current` still looks like a bare mount (the real race window)', () => {
    // At mount time state.screen is always the reducer's initial 'landing'
    // (the deep-link effect's own GOTO_SCREEN('companies') dispatch hasn't
    // landed in `state` yet) — this is exactly the window the old code
    // mistook for "nothing going on, safe to resume".
    expect(shouldResumeFromPointer({
      search: '?screen=companies', pointer, saved, session,
      current: { screen: 'landing', appSub: '', idea: '' },
    })).toBe(false)
  })

  it('still resumes on a genuinely bare reload — unaffected by this fix', () => {
    expect(shouldResumeFromPointer({
      search: '', pointer, saved, session,
    })).toBe(true)
  })

  it('still resumes with unrelated query params (no screen=companies)', () => {
    expect(shouldResumeFromPointer({
      search: '?utm_source=email', pointer, saved, session,
    })).toBe(true)
  })

  it('still refuses over an explicit ?screen=live&company= deep link — #1037 unaffected', () => {
    expect(shouldResumeFromPointer({
      search: '?screen=live&company=morphic', pointer, saved, session,
    })).toBe(false)
  })
})
