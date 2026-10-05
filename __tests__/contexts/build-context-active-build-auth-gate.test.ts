import { describe, it, expect } from 'vitest'
import { canResumeActiveBuild } from '@/contexts/build-context'

/**
 * #948 — a founder could reach real, live company generation without ever
 * signing up or authenticating. Root cause: the #669 resume-pointer effect
 * (BuildProvider, "Resume an in-progress build with no URL params at all")
 * restored a saved build and jumped straight to its screen (including `ws`,
 * the real workspace/generation screen) on EVERY bare `/build` mount where a
 * `ainative_active_build` localStorage pointer existed — with no check of
 * whether the current browser tab actually has an authenticated session.
 * Reproduced live: a genuinely signed-out new tab (confirmed via
 * fetch('/api/auth/session') -> null) still landed on `screen=ws` purely
 * from localStorage state left by an earlier (possibly different) visitor.
 *
 * Fix: gate the restore on a real resolved session, same authority
 * Intake.tsx already uses for its own auth wall (#dashboard-ux) —
 * useSession()'s fast path, falling back to a resolved getSession() to
 * cover the 'loading' race (RACE FIX, Intake.tsx). Exported as a pure
 * function so the actual decision is unit-testable without mounting the
 * full BuildProvider (OOMs jsdom via useAutoplay — see
 * build-context-url-sync-mount-race.test.ts's own note on this).
 */
describe('canResumeActiveBuild (#948)', () => {
  it('refuses to resume when there is no session at all (genuinely signed out)', () => {
    expect(canResumeActiveBuild(null)).toBe(false)
  })

  it('refuses to resume when the session has no user', () => {
    expect(canResumeActiveBuild({ user: undefined } as any)).toBe(false)
  })

  it('allows resuming when a real, authenticated session is present', () => {
    expect(canResumeActiveBuild({ user: { email: 'founder@ainative.studio' } } as any)).toBe(true)
  })
})
