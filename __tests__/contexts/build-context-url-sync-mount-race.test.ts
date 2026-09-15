import { describe, it, expect } from 'vitest'
import { computeSyncedUrl } from '@/contexts/build-context'

/**
 * #761 — a hard reload of the Live dashboard silently lost the deep-linked
 * company slug.
 *
 * Root cause: BuildProvider's #648 URL-sync effect (`useEffect(() => {...
 * computeSyncedUrl(window.location.href, state.screen) ...}, [state.screen])`)
 * and the deep-link-restore effect both fire in the SAME first-commit effect
 * flush on mount. The URL-sync effect closes over `state.screen` from the
 * render that was just committed — always `initialBuildState.screen`
 * ('landing') on a fresh mount — because the restore effect's dispatches
 * (RESTORE_BUILD/PICK_TRACK/START_BUILD/GOTO_SCREEN) only land in the NEXT
 * commit, not this one. Since 'landing' has no company context,
 * computeSyncedUrl stripped `?company=` (and `?view=`) from the real
 * browser URL on that very first pass — before the actual screen ('live')
 * was ever reflected in `state`. The reducer's in-memory state still ended
 * up correct for that session (Live.tsx never saw the wrong company), but
 * the URL itself had permanently lost the deep link, so a SUBSEQUENT hard
 * reload had nothing to restore from and fell back to the default company
 * ('your-company') for every companyId-scoped fetch on mount (chat
 * rehydration, visitors, provision, resolve-app, systems, nightshift,
 * register-app — confirmed live via Playwright).
 *
 * The fix (contexts/build-context.tsx) gates the URL-sync effect behind a
 * `useRef` mount guard so it no-ops on its first-ever run and only starts
 * reacting to screen changes AFTER the deep-link-restore effect (the sole
 * authority on the initial URL) has had its dispatches reflected in state.
 *
 * This test doesn't mount the full BuildProvider (which transitively pulls
 * in useAutoplay → primitive-catalog, a large module that OOMs jsdom in this
 * repo's Vitest setup — see useAutoplay-hook.test.ts's own note on this).
 * Instead it proves the underlying hazard directly: computeSyncedUrl, called
 * with the STALE first-render screen ('landing'), destructively strips a
 * real deep-linked company param that the very same effect flush is about
 * to restore into state — demonstrating why gating on first-run is required
 * rather than trusting the effect to "settle" on its own. The full
 * end-to-end behavior (real reload, real network requests using the
 * correct companyId) is covered by e2e/chat-persistence.spec.ts's
 * "send → reload restores the conversation" test, which reproduced this bug
 * deterministically (4/4) before this fix and passes after it.
 */
describe('URL-sync mount race (#761)', () => {
  it('demonstrates the hazard: computeSyncedUrl on the STALE initial screen strips a real deep link', () => {
    // The exact URL a founder's browser has right after `page.goto`
    // (?screen=live&company=<slug>), and the exact screen value the
    // URL-sync effect would see if it ran on the FIRST commit, before the
    // deep-link-restore effect's dispatches land (`initialBuildState.screen`).
    const deepLinkUrl = 'https://x.test/build?screen=live&company=memoryco-52-debug2'
    const staleFirstRenderScreen = 'landing'

    const corrupted = computeSyncedUrl(deepLinkUrl, staleFirstRenderScreen)
    expect(corrupted).not.toBeNull()
    const u = new URL(corrupted!)
    // This is the bug: a real deep link is destroyed because the effect ran
    // against a screen value that was never the true destination.
    expect(u.searchParams.has('company')).toBe(false)
    expect(u.searchParams.get('screen')).toBe('landing')
  })

  it('confirms the correct, POST-hydration screen would have been a no-op', () => {
    // Once state.screen genuinely reflects 'live' (the second commit, after
    // the deep-link-restore effect's dispatches apply), computeSyncedUrl
    // correctly leaves the URL untouched.
    const deepLinkUrl = 'https://x.test/build?screen=live&company=memoryco-52-debug2'
    const realScreen = 'live'

    const result = computeSyncedUrl(deepLinkUrl, realScreen)
    expect(result).toBeNull()
  })
})
