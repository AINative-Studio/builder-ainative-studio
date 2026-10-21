import { describe, it, expect } from 'vitest'
import { assertAuthSecretOrThrow } from '@/lib/env-check'

/**
 * #1194 — a missing AUTH_SECRET must hard-fail at startup in production,
 * never silently run on a derived, guessable secret (the prior behavior
 * hashed other env vars into AUTH_SECRET on every missing-secret case,
 * production included). nodeEnv/authSecret are explicit parameters (not
 * read from process.env internally) so both branches are exercised
 * deterministically without mutating global process.env state.
 */
describe('assertAuthSecretOrThrow (#1194)', () => {
  it('throws when AUTH_SECRET is missing and NODE_ENV is production', () => {
    expect(() => assertAuthSecretOrThrow('production', undefined)).toThrow(/AUTH_SECRET is not set/)
  })

  it('throws when AUTH_SECRET is an empty string and NODE_ENV is production', () => {
    expect(() => assertAuthSecretOrThrow('production', '')).toThrow(/AUTH_SECRET is not set/)
  })

  it('does NOT throw when AUTH_SECRET is missing and NODE_ENV is development (local-dev fallback path stays reachable)', () => {
    expect(() => assertAuthSecretOrThrow('development', undefined)).not.toThrow()
  })

  it('does NOT throw when AUTH_SECRET is missing and NODE_ENV is test', () => {
    expect(() => assertAuthSecretOrThrow('test', undefined)).not.toThrow()
  })

  it('does NOT throw when AUTH_SECRET is missing and NODE_ENV is unset', () => {
    expect(() => assertAuthSecretOrThrow(undefined, undefined)).not.toThrow()
  })

  it('does NOT throw in production when AUTH_SECRET IS set — a real secret always wins regardless of env', () => {
    expect(() => assertAuthSecretOrThrow('production', 'a-real-secret-value')).not.toThrow()
  })

  it('the thrown error message names the exact fix (openssl rand -base64 32 + AUTH_SECRET)', () => {
    try {
      assertAuthSecretOrThrow('production', undefined)
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(String(e)).toContain('openssl rand -base64 32')
      expect(String(e)).toContain('AUTH_SECRET')
    }
  })
})
