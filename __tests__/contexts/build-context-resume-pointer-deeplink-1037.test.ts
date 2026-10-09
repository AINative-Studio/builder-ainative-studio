import { describe, it, expect } from 'vitest'
import { shouldResumeFromPointer, canResumeActiveBuild } from '@/contexts/build-context'

/**
 * builder#1037, bounce path A — the one actually responsible for the reported
 * ~1-2s silent bounce, attributed by instrumenting the real dispatch sites and
 * reading the origin back out of a live Chromium browser (3/3 deterministic):
 *
 *   BOUNCE ORIGIN: [["resume-669","companies", ...]]
 *
 * The #669 resume effect exists for ONE case its own doc comment names
 * precisely: "a genuinely bare reload or fresh tab of /build (no query params)"
 * where nothing in the URL says where the founder was. It samples
 * `state.screen === 'landing'` on the first commit — which is ALWAYS true on a
 * fresh mount, because the deep-link effect's own dispatches land in the NEXT
 * commit (the same ordering #761 documents for the URL-sync effect). It then
 * awaits `getSession()` and, ~1-2s later, dispatches GOTO_SCREEN(pointer.screen)
 * unconditionally — overwriting whatever destination the deep-link effect had
 * already committed in the meantime.
 *
 * So an explicit `?screen=live&company=<slug>` deep link — the exact URL
 * MyCompanies' openLive() navigates to via window.location.href — loses to a
 * stale localStorage pointer. And `noResumeScreens` does not include
 * 'companies', so the pointer routinely says 'companies': the founder is
 * bounced from their own Live dashboard straight back to the screen they
 * clicked "Open dashboard" on.
 *
 * Fix: the deep link is the explicit, user-expressed destination and must win.
 * The pointer is a best-effort fallback for a URL that says nothing.
 */
describe('shouldResumeFromPointer (#1037 path A)', () => {
  const session = { user: { email: 'founder@ainative.studio' } }
  const pointer = { slug: 'silo', screen: 'companies' }
  const savedStale = { builtCompany: false, appChatId: '' }

  it('REFUSES to resume over an explicit ?screen=live&company= deep link — the reported bounce', () => {
    expect(shouldResumeFromPointer({
      search: '?screen=live&company=silo', pointer, saved: savedStale, session,
    })).toBe(false)
  })

  it('REFUSES to resume over an explicit workspace deep link too', () => {
    expect(shouldResumeFromPointer({
      search: '?screen=ws&company=silo&view=thesis', pointer, saved: savedStale, session,
    })).toBe(false)
  })

  it('REFUSES even when the pointer names the SAME screen the deep link asked for (the deep-link effect already handled it)', () => {
    expect(shouldResumeFromPointer({
      search: '?screen=live&company=silo',
      pointer: { slug: 'silo', screen: 'live' }, saved: savedStale, session,
    })).toBe(false)
  })

  it('STILL resumes on a genuinely bare /build load — #669\'s own stated case, unbroken', () => {
    expect(shouldResumeFromPointer({
      search: '', pointer: { slug: 'silo', screen: 'ws' }, saved: savedStale, session,
    })).toBe(true)
  })

  it('still resumes when the URL has params but no company-scoped deep link', () => {
    expect(shouldResumeFromPointer({
      search: '?utm_source=email', pointer: { slug: 'silo', screen: 'ws' }, saved: savedStale, session,
    })).toBe(true)
  })

  it('still refuses with no pointer at all', () => {
    expect(shouldResumeFromPointer({ search: '', pointer: null, saved: savedStale, session })).toBe(false)
  })

  it('still refuses with no saved per-slug state — the #669 effect\'s own existing bail (and the reported workaround)', () => {
    expect(shouldResumeFromPointer({
      search: '', pointer: { slug: 'silo', screen: 'ws' }, saved: null, session,
    })).toBe(false)
  })

  it('still refuses without a real session — #948\'s auth gate is preserved exactly', () => {
    expect(shouldResumeFromPointer({
      search: '', pointer: { slug: 'silo', screen: 'ws' }, saved: savedStale, session: null,
    })).toBe(false)
    expect(shouldResumeFromPointer({
      search: '', pointer: { slug: 'silo', screen: 'ws' }, saved: savedStale, session: { user: undefined },
    })).toBe(false)
  })

  it('agrees with canResumeActiveBuild on the session question (one authority, not two)', () => {
    const base = { search: '', pointer: { slug: 'silo', screen: 'ws' }, saved: savedStale }
    for (const s of [null, { user: undefined }, { user: { email: 'a@b.c' } }] as const) {
      expect(shouldResumeFromPointer({ ...base, session: s })).toBe(canResumeActiveBuild(s))
    }
  })
})
