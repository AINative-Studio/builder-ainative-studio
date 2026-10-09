import { describe, it, expect } from 'vitest'
import {
  isSavedBuildStateComplete,
  isExplicitCompanyDeepLink,
  isDeepLinkCompanyNotFound,
} from '@/contexts/build-context'

/**
 * builder#1037 — a founder with a genuinely registered, server-confirmed-live
 * company was silently bounced off their own Live dashboard back to "My
 * companies" (reproduced 4/4 live on production, and 3/3 in a real Chromium
 * browser against a local dev server during this fix).
 *
 * TWO independent, separately-reproduced bounce paths, both attributed by
 * instrumenting the real dispatch sites and reading back the origin in the
 * browser:
 *
 *   A. `['resume-669', 'companies']` — the #669 active-build resume effect.
 *      `noResumeScreens` does NOT contain 'companies', so a founder sitting on
 *      ?screen=companies with a `state.appSub` still set persists
 *      `ainative_active_build = { slug, screen: 'companies' }`. Their very next
 *      "Open dashboard" click (a FULL page load of ?screen=live&company=<slug>,
 *      per MyCompanies' openLive()) then races: the deep-link effect sets
 *      screen 'live' synchronously, but the resume effect — which sampled
 *      `state.screen === 'landing'` on the first commit — resolves its
 *      `getSession()` ~1-2s later and dispatches GOTO_SCREEN('companies') right
 *      over the top of it. Exactly the reported ~1-2s silent bounce.
 *
 *   B. `['buildapp-mycompanies', 'landing']` — BuildApp.tsx's ScreenRouter
 *      "signed in WITH projects → show their dashboard" effect. Its own
 *      re-check (`screenRef.current === 'landing'`) is sampled at fetch-resolve
 *      time, but ScreenRouter is a CHILD of BuildProvider, so its effect runs
 *      BEFORE the deep-link effect's dispatches are committed. A fast/cached
 *      /api/build/my-companies response resolves inside that window and the
 *      guard still reads 'landing'.
 *
 * Neither path consults the server about the deep-linked company at all. And
 * the stale per-slug cache is what makes path A reachable: the resume effect
 * bails via `if (!saved) { clearActiveBuild(); return }`, so a browser with no
 * `ainative_build_<slug>` entry never bounces — which is precisely why the
 * reported workaround (clear that one key, reload) worked.
 *
 * Tested as pure decisions per this file's own established pattern
 * (canResumeActiveBuild, computeSyncedUrl, isDeepLinkCompanyNotFound) —
 * mounting the full BuildProvider OOMs jsdom via useAutoplay, see
 * build-context-url-sync-mount-race.test.ts's own note on this.
 */

/** The real, byte-for-byte stale shape read out of production localStorage. */
const STALE_SAVED = {
  builtCompany: false,
  builtMVP: false,
  appChatId: '',
  productChatId: '',
  sawPreview: false,
  generated: {},
  done: {},
  track: 'company' as const,
}

describe('isSavedBuildStateComplete (#1037)', () => {
  it('rejects the exact stale shape found live — no chatIds, no completion flags, empty generated/done', () => {
    expect(isSavedBuildStateComplete(STALE_SAVED)).toBe(false)
  })

  it('rejects null (no cache entry at all) — the caller must fall through to the verified network path', () => {
    expect(isSavedBuildStateComplete(null)).toBe(false)
  })

  it('rejects an empty object', () => {
    expect(isSavedBuildStateComplete({})).toBe(false)
  })

  it('accepts a genuinely complete Company-track cache (builtCompany true + a real appChatId)', () => {
    expect(isSavedBuildStateComplete({
      ...STALE_SAVED, builtCompany: true, appChatId: 'JMBmjUQcE_FBl3SDKW68k',
    })).toBe(true)
  })

  it('accepts a genuinely complete App-track cache (builtMVP true + a real appChatId)', () => {
    expect(isSavedBuildStateComplete({
      ...STALE_SAVED, track: 'app', builtMVP: true, appChatId: 'JMBmjUQcE_FBl3SDKW68k',
    })).toBe(true)
  })

  it('accepts a cache whose proof of a real registered app is a productChatId', () => {
    expect(isSavedBuildStateComplete({
      ...STALE_SAVED, builtCompany: true, productChatId: 'prod-chat-real',
    })).toBe(true)
  })

  it('rejects a completion flag with NO registered chatId — the half-written state that caused this bug', () => {
    // The real stale entry's distinguishing feature: completion claimed
    // locally but nothing server-side ever proved it. Must re-verify.
    expect(isSavedBuildStateComplete({ ...STALE_SAVED, builtCompany: true })).toBe(false)
  })

  it('rejects a chatId with NO completion flag — mid-build, not a finished company', () => {
    expect(isSavedBuildStateComplete({ ...STALE_SAVED, appChatId: 'mid-build-chat' })).toBe(false)
  })

  it('ignores a whitespace-only chatId (never a real registered app)', () => {
    expect(isSavedBuildStateComplete({ ...STALE_SAVED, builtCompany: true, appChatId: '   ' })).toBe(false)
  })

  it('does not accept the wrong track\'s completion flag (App-track cache completing via builtCompany)', () => {
    expect(isSavedBuildStateComplete({
      ...STALE_SAVED, track: 'app', builtCompany: true, builtMVP: false, appChatId: 'real',
    })).toBe(false)
  })

  it('treats a missing track as the Company track (the deep-link effect\'s own back-compat default)', () => {
    const { track: _omit, ...noTrack } = STALE_SAVED
    expect(isSavedBuildStateComplete({ ...noTrack, builtCompany: true, appChatId: 'real' })).toBe(true)
  })
})

describe('isExplicitCompanyDeepLink (#1037)', () => {
  it('is true for the real "Open dashboard" URL MyCompanies constructs', () => {
    expect(isExplicitCompanyDeepLink('?screen=live&company=silo')).toBe(true)
  })

  it('is true for a workspace deep link', () => {
    expect(isExplicitCompanyDeepLink('?screen=ws&company=silo&view=thesis')).toBe(true)
  })

  it('is false for a bare /build load — exactly the case #669 resume exists to serve', () => {
    expect(isExplicitCompanyDeepLink('')).toBe(false)
    expect(isExplicitCompanyDeepLink('?')).toBe(false)
  })

  it('is false for ?screen= with no company (nothing company-scoped to protect)', () => {
    expect(isExplicitCompanyDeepLink('?screen=companies')).toBe(false)
  })

  it('is false for ?company= with no screen (no explicit destination was asked for)', () => {
    expect(isExplicitCompanyDeepLink('?company=silo')).toBe(false)
  })

  it('is false for an unknown screen the deep-link effect would not honor anyway', () => {
    expect(isExplicitCompanyDeepLink('?screen=bogus&company=silo')).toBe(false)
  })

  it('is false for an empty company value', () => {
    expect(isExplicitCompanyDeepLink('?screen=live&company=')).toBe(false)
  })

  it('tolerates a full URL as well as a bare search string', () => {
    expect(isExplicitCompanyDeepLink('https://builder.ainative.studio/build?screen=live&company=silo')).toBe(true)
  })
})

/**
 * The pre-existing #807/#832 `verified` guard (isDeepLinkCompanyNotFound) must
 * keep working EXACTLY as before. #1037's fix sends strictly MORE traffic
 * through that guard (every incomplete cache now re-verifies instead of
 * skipping), so a genuinely deleted/renamed company must still land on the
 * honest "not found" state — never get "fixed into" a false-positive
 * re-verification that silently succeeds.
 */
describe('coexistence with the #807/#832 verified guard', () => {
  it('a confirmed-missing company is still flagged not-found even though the stale cache now re-verifies', () => {
    expect(isSavedBuildStateComplete(STALE_SAVED)).toBe(false) // → falls through to resolve-app
    expect(isDeepLinkCompanyNotFound({ chatId: null, idea: null, verified: true })).toBe(true)
  })

  it('a real, live company reached through the SAME new re-verification path is NOT flagged — the #1037 case', () => {
    expect(isSavedBuildStateComplete(STALE_SAVED)).toBe(false) // → falls through to resolve-app
    // The real production response for the reported company.
    expect(isDeepLinkCompanyNotFound({
      chatId: 'JMBmjUQcE_FBl3SDKW68k', idea: 'silo', verified: true,
    })).toBe(false)
  })

  it('an unverified resolve-app failure on a newly-re-verified stale cache still fails OPEN', () => {
    expect(isDeepLinkCompanyNotFound({ chatId: null, idea: null, verified: false })).toBe(false)
  })

  it('a genuinely complete cache skips the network entirely, so the guard is never consulted for it', () => {
    // The no-regression contract: the common case must add ZERO latency.
    expect(isSavedBuildStateComplete({
      ...STALE_SAVED, builtCompany: true, appChatId: 'JMBmjUQcE_FBl3SDKW68k',
    })).toBe(true)
  })
})
