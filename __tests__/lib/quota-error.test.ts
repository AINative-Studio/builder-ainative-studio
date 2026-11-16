import { describe, it, expect } from 'vitest'
import { isQuotaError, QUOTA_USER_MESSAGE } from '@/lib/quota-error'

describe('isQuotaError', () => {
  it('detects the live 402 monthly_token_limit_exceeded agent error string', () => {
    const real =
      '[ERR_API] AINative API error: 402 {"type":"error","error":{"type":"billing_error","message":"{\'error\': {\'code\': \'monthly_token_limit_exceeded\', \'message\': \\"You\'ve used your monthly token allotment (50,038,041 of 50,000,000 on the \'enterprise\' plan). Upgrade your plan or add credits to continue.\\", \'tier\': \'enterprise\', \'limit\': 50000000}}"}}'
    expect(isQuotaError(real)).toBe(true)
  })

  it('detects a structured error object with status 402', () => {
    expect(isQuotaError({ status: 402, message: 'Payment Required' })).toBe(true)
    expect(isQuotaError({ statusCode: 402 })).toBe(true)
    expect(isQuotaError({ code: 402 })).toBe(true)
  })

  it('detects billing_error and add-credits markers regardless of status', () => {
    expect(isQuotaError('upstream returned billing_error')).toBe(true)
    expect(isQuotaError('Upgrade your plan or add credits to continue')).toBe(true)
    expect(isQuotaError('token allotment exhausted')).toBe(true)
  })

  it('does NOT match ordinary agent failures (should fall through to fallback)', () => {
    expect(isQuotaError('Agent crashed: timeout after 120s')).toBe(false)
    expect(isQuotaError('validation failed: missing default export')).toBe(false)
    expect(isQuotaError({ status: 500, message: 'internal error' })).toBe(false)
    expect(isQuotaError('rate limited 429')).toBe(false)
  })

  it('does not match a bare 402 without a billing marker (avoids false positives on random numbers)', () => {
    expect(isQuotaError('processed 402 records successfully')).toBe(false)
  })

  it('handles null/undefined/empty safely', () => {
    expect(isQuotaError(null)).toBe(false)
    expect(isQuotaError(undefined)).toBe(false)
    expect(isQuotaError('')).toBe(false)
  })

  // #2094: found via live E2E testing — a real `Error` instance's `message`
  // is a non-enumerable property, so JSON.stringify(err) silently returns
  // "{}" for a plain `new Error(...)` (it never throws, so the old
  // fallback-to-.message branch — written for a JSON.stringify THROW, e.g. a
  // circular reference — never actually ran for this, the single most common
  // error shape in JS). A quota error thrown as a real Error object anywhere
  // in the call stack (rather than passed as a bare string or a parsed API
  // response object) was therefore completely invisible to this detector,
  // silently falling through to a generic/unclassified failure message.
  it('#2094: detects a quota marker in a real Error instance\'s message (not just a bare string or object)', () => {
    expect(isQuotaError(new Error('monthly_token_limit_exceeded: add credits to continue'))).toBe(true)
    expect(isQuotaError(new Error('upstream returned billing_error'))).toBe(true)
  })

  it('#2094: a real Error instance with an ordinary (non-quota) message still correctly returns false', () => {
    expect(isQuotaError(new Error('zeromemory recall failed'))).toBe(false)
    expect(isQuotaError(new Error('Agent crashed: timeout after 120s'))).toBe(false)
  })

  it('exposes a user-facing message', () => {
    expect(QUOTA_USER_MESSAGE).toMatch(/monthly token limit/i)
  })
})
