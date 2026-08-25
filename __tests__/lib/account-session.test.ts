import { describe, it, expect } from 'vitest'
import { isGuestSession, getDisplayName, getDisplayEmail } from '@/lib/build/account-session'
import type { Session } from 'next-auth'

/**
 * #50 — unit tests for the guest-vs-authenticated session detection logic.
 * Coverage target: ≥80% of lib/build/account-session.ts branches.
 *
 * We construct minimal Session-shaped objects rather than mocking next-auth,
 * keeping these tests dependency-free and fast.
 */

function makeSession(overrides: Partial<{ email: string; name: string; type: string }>): Session {
  const { email = 'user@example.com', name = '', type = 'regular' } = overrides
  return {
    user: { email, name, image: null, id: 'u1', type } as any,
    expires: '2099-01-01',
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// isGuestSession
// ──────────────────────────────────────────────────────────────────────────────

describe('isGuestSession (#50)', () => {
  it('returns true when session is null', () => {
    expect(isGuestSession(null)).toBe(true)
  })

  it('returns true when session is undefined', () => {
    expect(isGuestSession(undefined)).toBe(true)
  })

  it('returns true when user.type is "guest"', () => {
    const s = makeSession({ type: 'guest', email: 'founder@real.com' })
    expect(isGuestSession(s)).toBe(true)
  })

  it('returns true when email matches the guest-<uuid>@example.com pattern', () => {
    const s = makeSession({ email: 'guest-71f8b8c05@example.com', type: 'regular' })
    expect(isGuestSession(s)).toBe(true)
  })

  it('returns true for a full UUID-style guest email', () => {
    const s = makeSession({ email: 'guest-a1b2c3d4-e5f6-7890-abcd-ef1234567890@example.com', type: 'regular' })
    expect(isGuestSession(s)).toBe(true)
  })

  it('returns false for a real authenticated user (type=regular)', () => {
    const s = makeSession({ type: 'regular', email: 'founder@acme.com' })
    expect(isGuestSession(s)).toBe(false)
  })

  it('returns false for an AINative OAuth user (type=ainative)', () => {
    const s = makeSession({ type: 'ainative', email: 'toby@ainative.studio' })
    expect(isGuestSession(s)).toBe(false)
  })

  it('returns false for a regular email that contains the word "guest" but is not the pattern', () => {
    const s = makeSession({ email: 'guest@mycompany.com', type: 'regular' })
    expect(isGuestSession(s)).toBe(false)
  })

  it('returns false when email is a real @example.com that does not start with guest-', () => {
    const s = makeSession({ email: 'alice@example.com', type: 'regular' })
    expect(isGuestSession(s)).toBe(false)
  })

  it('returns true when type=guest even if email looks real', () => {
    // Type is the canonical signal; email mismatch should not override it.
    const s = makeSession({ type: 'guest', email: 'real-looking@company.com' })
    expect(isGuestSession(s)).toBe(true)
  })

  it('handles a session with no email gracefully (does not throw)', () => {
    const s = { user: { id: 'u1', type: 'regular' }, expires: '2099-01-01' } as unknown as Session
    expect(() => isGuestSession(s)).not.toThrow()
    expect(isGuestSession(s)).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// getDisplayName
// ──────────────────────────────────────────────────────────────────────────────

describe('getDisplayName (#50)', () => {
  it('returns "Guest" for a null session', () => {
    expect(getDisplayName(null)).toBe('Guest')
  })

  it('returns "Guest" for a guest session', () => {
    const s = makeSession({ type: 'guest', email: 'guest-abc@example.com', name: '' })
    expect(getDisplayName(s)).toBe('Guest')
  })

  it('returns the user name when present (authenticated)', () => {
    const s = makeSession({ type: 'regular', name: 'Toby Smith', email: 'toby@acme.com' })
    expect(getDisplayName(s)).toBe('Toby Smith')
  })

  it('falls back to the email local-part when name is absent', () => {
    const s = makeSession({ type: 'regular', name: '', email: 'founder@acme.com' })
    expect(getDisplayName(s)).toBe('founder')
  })

  it('falls back to "You" when name and email are both absent', () => {
    const s = { user: { id: 'u1', type: 'regular', email: '' }, expires: '2099-01-01' } as unknown as Session
    expect(getDisplayName(s)).toBe('You')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// getDisplayEmail
// ──────────────────────────────────────────────────────────────────────────────

describe('getDisplayEmail (#50)', () => {
  it('returns null for a null session', () => {
    expect(getDisplayEmail(null)).toBeNull()
  })

  it('returns null for a guest session (suppresses the synthetic email)', () => {
    const s = makeSession({ type: 'guest', email: 'guest-71f8b8c05@example.com' })
    expect(getDisplayEmail(s)).toBeNull()
  })

  it('returns the real email for an authenticated user', () => {
    const s = makeSession({ type: 'regular', email: 'toby@ainative.studio' })
    expect(getDisplayEmail(s)).toBe('toby@ainative.studio')
  })

  it('returns null when authenticated but email is absent', () => {
    const s = { user: { id: 'u1', type: 'regular', email: '' }, expires: '2099-01-01' } as unknown as Session
    expect(getDisplayEmail(s)).toBeNull()
  })
})
