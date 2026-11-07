import { describe, it, expect } from 'vitest'
import {
  CAPACITY_EXHAUSTED_CODE,
  CAPACITY_USER_MESSAGE,
  isCapacityExhaustedError,
  makeCapacityExhaustedError,
} from '@/lib/capacity-error'

describe('makeCapacityExhaustedError / isCapacityExhaustedError', () => {
  it('tags the error it creates with the capacity-exhausted code', () => {
    const err = makeCapacityExhaustedError()
    expect(err).toBeInstanceOf(Error)
    expect((err as any).code).toBe(CAPACITY_EXHAUSTED_CODE)
  })

  it('recognizes an error tagged with the capacity-exhausted code', () => {
    expect(isCapacityExhaustedError(makeCapacityExhaustedError())).toBe(true)
    expect(isCapacityExhaustedError({ code: CAPACITY_EXHAUSTED_CODE })).toBe(true)
  })

  it('does NOT match an ordinary error, including a differently-coded one', () => {
    expect(isCapacityExhaustedError(new Error('Core structure (Phase 1) failed or is missing - cannot merge'))).toBe(false)
    expect(isCapacityExhaustedError({ code: 'quota_exhausted' })).toBe(false)
    expect(isCapacityExhaustedError({ status: 429 })).toBe(false)
  })

  it('handles null/undefined/non-object safely', () => {
    expect(isCapacityExhaustedError(null)).toBe(false)
    expect(isCapacityExhaustedError(undefined)).toBe(false)
    expect(isCapacityExhaustedError('some string error')).toBe(false)
  })

  it('exposes a founder-honest, non-blaming user-facing message', () => {
    expect(CAPACITY_USER_MESSAGE).toMatch(/capacity/i)
    expect(CAPACITY_USER_MESSAGE).toMatch(/nothing is wrong with your idea/i)
  })
})
