import { describe, it, expect } from 'vitest'
import { shouldResumeFromPointer } from '@/contexts/build-context'

/**
 * builder#1049, the second half of the stall's root cause.
 *
 * The #669 active-build resume effect samples `state.screen === 'landing'`
 * (always true on a fresh mount — the deep-link effect's own dispatches only
 * land in the NEXT commit, the ordering #761 documents) and then awaits
 * getSession(). When that resolves it dispatches RESTORE_BUILD(saved) +
 * GOTO_SCREEN(pointer.screen) — restoring some OTHER, previously-touched
 * company straight over the top of whatever the founder is doing by then.
 *
 * #1037 closed one door: an explicit `?screen=&company=` deep link now wins.
 * But the reported #1049 path never has a deep link. The founder lands on a
 * bare /build, and then starts a BRAND-NEW build entirely client-side —
 * "+ New company" → Fork → App track → idea → kickoff → design pick are all
 * GOTO_SCREEN/PICK_TRACK dispatches that never touch the URL's `company`
 * param. So `isExplicitCompanyDeepLink` stays false the whole way, the
 * pointer stays "valid", and the resume fires into a live, in-flight build.
 *
 * What it does on arrival is the stall: RESTORE_BUILD replaces `track`,
 * `done`, `idea`, `appSub` and `companyName` with the stale company's, and
 * (#1033) forces `auto: false` when that company had finished — so autoplay
 * stops dead, the founder's own half-generated App build is gone, and the
 * workspace sits on a frozen generating skeleton with "Keep going →" as the
 * only way out. Exactly the reported symptom, including why clicking "Keep
 * going" unstuck it and why it never recurred for the rest of that run (the
 * effect is one-shot per mount).
 *
 * `shouldRouteToCompaniesIndex` in components/build/BuildApp.tsx already
 * solved precisely this shape of problem for the sibling my-companies front
 * door: it re-checks, at resolve time, whether the founder has since
 * navigated. This pointer resume had no such clause. It does now.
 */
describe('shouldResumeFromPointer — must not land on a live build (#1049)', () => {
  const session = { user: { email: 'founder@ainative.studio' } }
  const pointer = { slug: 'oldco-company-run', screen: 'ws' }
  const saved = { builtCompany: true, appChatId: 'chat-old', track: 'company' }

  it('REFUSES once the founder has started their own build (the reported stall)', () => {
    expect(shouldResumeFromPointer({
      search: '', pointer, saved, session,
      // The founder clicked through to the workspace while getSession() was
      // still in flight. There is a real, live build here now.
      current: { screen: 'ws', appSub: 'tipsplit-abc123', idea: 'a tip-splitting app' },
    })).toBe(false)
  })

  it('REFUSES from a DELIBERATE funnel entry even before a slug or idea exists', () => {
    // Live-verified regression: the founder clicked "Get started" (screen
    // 'start') while getSession() was still held, had committed no idea yet,
    // and the resume still yanked them to ?screen=ws&view=plan30 of an old
    // company. BuildApp.tsx's sibling front door already states the rule this
    // must follow: "a founder who deliberately navigates into the funnel
    // ('+ New company', Get started) is never yanked out of it."
    for (const screen of ['start', 'build'] as const) {
      expect(
        shouldResumeFromPointer({
          search: '', pointer, saved, session,
          current: { screen, appSub: '', idea: '' },
        }),
        `must not resume over a founder who deliberately entered the funnel at '${screen}'`,
      ).toBe(false)
    }
  })

  it('REFUSES for every mid-funnel screen a founder can be on when the session resolves', () => {
    for (const screen of ['fork', 'intake', 'kickoff', 'ws', 'pricing', 'live'] as const) {
      expect(
        shouldResumeFromPointer({
          search: '', pointer, saved, session,
          current: { screen, appSub: 'tipsplit-abc123', idea: 'an idea' },
        }),
        `must not resume over a founder sitting on '${screen}'`,
      ).toBe(false)
    }
  })

  it('REFUSES when the founder has typed an idea but has no slug yet (pre-START_BUILD)', () => {
    expect(shouldResumeFromPointer({
      search: '', pointer, saved, session,
      current: { screen: 'intake', appSub: '', idea: 'a tip-splitting app for group dinners' },
    })).toBe(false)
  })

  it('REFUSES when the pointer names a DIFFERENT company than the live build', () => {
    expect(shouldResumeFromPointer({
      search: '', pointer, saved, session,
      current: { screen: 'ws', appSub: 'some-other-company', idea: 'x' },
    })).toBe(false)
  })

  it('STILL resumes on a genuinely bare reload — #669\'s own stated case, unbroken', () => {
    expect(shouldResumeFromPointer({
      search: '', pointer, saved, session,
      // Nothing has happened yet: still on the landing screen, no build.
      current: { screen: 'landing', appSub: '', idea: '' },
    })).toBe(true)
  })

  it('STILL resumes when the pointer IS the company already in state (a real reload of that build)', () => {
    expect(shouldResumeFromPointer({
      search: '', pointer, saved, session,
      current: { screen: 'landing', appSub: 'oldco-company-run', idea: 'an old finished company' },
    })).toBe(true)
  })

  it('keeps every pre-existing refusal intact (deep link / no pointer / no saved / no session)', () => {
    const current = { screen: 'landing', appSub: '', idea: '' }
    expect(shouldResumeFromPointer({
      search: '?screen=live&company=oldco-company-run', pointer, saved, session, current,
    })).toBe(false)
    expect(shouldResumeFromPointer({ search: '', pointer: null, saved, session, current })).toBe(false)
    expect(shouldResumeFromPointer({ search: '', pointer, saved: null, session, current })).toBe(false)
    expect(shouldResumeFromPointer({ search: '', pointer, saved, session: null, current })).toBe(false)
  })

  it('treats a missing `current` as "nothing live" so existing callers/tests are unaffected', () => {
    expect(shouldResumeFromPointer({ search: '', pointer, saved, session })).toBe(true)
  })
})
