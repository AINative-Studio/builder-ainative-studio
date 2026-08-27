import { describe, it, expect } from 'vitest'
import { messageForOAuthError } from '@/lib/auth/oauth-error-messages'

describe('messageForOAuthError (#294)', () => {
  it('exchange_failed → friendly retry message', () => {
    const m = messageForOAuthError('ainative_exchange_failed')
    expect(m).toMatch(/temporary issue/i)
    expect(m).toMatch(/try again/i)
  })

  it('invalid_state/state_mismatch → expired message', () => {
    expect(messageForOAuthError('ainative_invalid_state')).toMatch(/expired/i)
    expect(messageForOAuthError('ainative_state_mismatch')).toMatch(/expired/i)
  })

  it('access_denied → cancelled message', () => {
    expect(messageForOAuthError('ainative_access_denied')).toMatch(/cancelled/i)
  })

  it('unknown ainative_ code → generic ainative message', () => {
    expect(messageForOAuthError('ainative_something_new')).toMatch(/didn’t complete/i)
  })

  it('no code → null (no banner)', () => {
    expect(messageForOAuthError(undefined)).toBeNull()
    expect(messageForOAuthError('')).toBeNull()
    expect(messageForOAuthError(null)).toBeNull()
  })

  it('non-ainative code → null (do not surface noise)', () => {
    expect(messageForOAuthError('CredentialsSignin')).toBeNull()
    expect(messageForOAuthError('random_error')).toBeNull()
  })
})
