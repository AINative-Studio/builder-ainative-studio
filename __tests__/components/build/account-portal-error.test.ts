import { describe, it, expect } from 'vitest'
import { portalErrorMessage } from '@/components/build/screens/Account'

/**
 * Real bug (live, Enterprise account, screenshot-reported 2026-09-08):
 * "Manage plan / billing" silently did nothing on failure — the fetch's
 * catch block had no error state at all, so a founder whose account has no
 * real Stripe customer behind it (plausible for an internally-granted
 * Enterprise plan) saw the button flip back to its idle label with zero
 * indication anything went wrong. portalErrorMessage always returns a
 * non-empty, actionable message so this can never be silent again.
 */
describe('portalErrorMessage (pure)', () => {
  it('THE BUG: never returns an empty string', () => {
    expect(portalErrorMessage(undefined)).not.toBe('')
    expect(portalErrorMessage(null)).not.toBe('')
    expect(portalErrorMessage('')).not.toBe('')
  })

  it('uses the real server error message when one is provided', () => {
    expect(portalErrorMessage('no Stripe customer on this account')).toBe(
      'no Stripe customer on this account',
    )
  })

  it('falls back to an actionable support message with no server error', () => {
    const msg = portalErrorMessage()
    expect(msg).toContain('support@ainative.studio')
  })

  it('trims whitespace-only server errors to the fallback', () => {
    expect(portalErrorMessage('   ')).toContain('support@ainative.studio')
  })
})
