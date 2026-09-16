import { describe, it, expect } from 'vitest'
import { shouldRefreshToken } from '@/lib/auth/tokenRefresh'

/**
 * Real bug fixed live (#792, found investigating #778): a stored credential
 * row with NO `expiresAt` at all (every row captured before the #443/#664
 * fix started populating it) used to make shouldRefreshToken(undefined)
 * return false — "assume it's fine forever" — so it was never proactively
 * refreshed no matter how stale. Confirmed live: Fieldko's stored `zerocrm`
 * credential was genuinely dead (core's own /api/v1/auth/me returned
 * 401 AUTH_TOKEN_INVALID) yet resolveFounderCredential (no forceRefresh)
 * happily returned it as valid because shouldRefreshToken(undefined) said
 * no refresh was needed.
 */
describe('shouldRefreshToken (#792)', () => {
  it('returns true when expiresAt is undefined — missing data means "assume refresh needed", not "eternal token"', () => {
    expect(shouldRefreshToken(undefined)).toBe(true)
  })

  it('returns false for a token expiring well in the future (no unnecessary refresh)', () => {
    const farFuture = Date.now() + 60 * 60 * 1000 // 1 hour out
    expect(shouldRefreshToken(farFuture)).toBe(false)
  })

  it('returns true for a token already inside the 5-minute refresh buffer', () => {
    const almostExpired = Date.now() + 60 * 1000 // 1 minute out, inside 5-min buffer
    expect(shouldRefreshToken(almostExpired)).toBe(true)
  })

  it('returns true for a token already past expiry', () => {
    const past = Date.now() - 1000
    expect(shouldRefreshToken(past)).toBe(true)
  })
})
