import { describe, it, expect } from 'vitest'
import { KNOWN_DEEP_LINK_SCREENS } from '@/contexts/build-context'

/**
 * #651 follow-up — found live while verifying the auth back-navigation fix:
 * a direct/bookmarked ?screen=forgot (or ?screen=reset) URL always landed on
 * 'landing' instead of the forgot-password screen. The Auth screen's own
 * in-app navigation (GOTO_SCREEN('forgot')) worked correctly — the gap was
 * this allowlist gating the deep-link restore effect, which had never
 * included 'forgot'/'reset' even though both are real, reachable Screen
 * values in lib/build/state.ts and handled identically by the reducer.
 */
describe('KNOWN_DEEP_LINK_SCREENS (#651 follow-up)', () => {
  it('includes every auth screen, so a direct link to any of them restores correctly', () => {
    for (const screen of ['login', 'signup', 'forgot', 'reset']) {
      expect(KNOWN_DEEP_LINK_SCREENS).toContain(screen)
    }
  })

  it('still includes the screens that already worked, unchanged', () => {
    for (const screen of ['landing', 'start', 'build', 'fork', 'intake', 'ws', 'pricing', 'live', 'account', 'companies', 'refer']) {
      expect(KNOWN_DEEP_LINK_SCREENS).toContain(screen)
    }
  })

  it('has no duplicate entries', () => {
    expect(new Set(KNOWN_DEEP_LINK_SCREENS).size).toBe(KNOWN_DEEP_LINK_SCREENS.length)
  })
})
