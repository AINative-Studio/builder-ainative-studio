import { describe, it, expect, vi } from 'vitest'
import {
  runValidationRetryLoop,
  buildRepairPrompt,
  type RetryValidation,
} from '@/lib/generation-retry'

const invalid = (code = 'bad', error = 'Unexpected token'): RetryValidation => ({
  valid: false,
  error,
  code,
})
const valid = (code = 'good'): RetryValidation => ({ valid: true, code })

/** A validator that returns valid once the raw output contains "FIXED". */
const validateOnFixed = (raw: string): RetryValidation =>
  raw.includes('FIXED') ? valid(raw) : invalid(raw, 'still broken')

describe('runValidationRetryLoop (#77)', () => {
  it('recovers on the first attempt', async () => {
    const generate = vi.fn().mockResolvedValue('x'.repeat(600) + 'FIXED')
    const r = await runValidationRetryLoop(invalid(), {
      models: ['m1', 'm2', 'm3'],
      prompt: 'build x',
      generate,
      validate: validateOnFixed,
    })
    expect(r.recovered).toBe(true)
    expect(r.attempts).toBe(1)
    expect(r.validation.valid).toBe(true)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('recovers on a later attempt and rotates models', async () => {
    const seen: string[] = []
    const generate = vi.fn(async (model: string) => {
      seen.push(model)
      return seen.length >= 2 ? 'y'.repeat(600) + 'FIXED' : 'z'.repeat(600)
    })
    const r = await runValidationRetryLoop(invalid(), {
      models: ['m1', 'm2', 'm3'],
      prompt: 'p',
      generate,
      validate: validateOnFixed,
    })
    expect(r.recovered).toBe(true)
    expect(r.attempts).toBe(2)
    expect(seen).toEqual(['m1', 'm2'])
  })

  it('exhausts after maxRetries without recovering', async () => {
    const generate = vi.fn().mockResolvedValue('a'.repeat(600)) // never FIXED
    const r = await runValidationRetryLoop(invalid(), {
      maxRetries: 3,
      models: ['m1'],
      prompt: 'p',
      generate,
      validate: validateOnFixed,
    })
    expect(r.recovered).toBe(false)
    expect(r.attempts).toBe(3)
    expect(generate).toHaveBeenCalledTimes(3)
  })

  it('feeds the NEW error into the next attempt', async () => {
    const errorsSeen: string[] = []
    let call = 0
    const generate = vi.fn(async (_m: string, error: string) => {
      errorsSeen.push(error)
      call++
      return call >= 2 ? 'q'.repeat(600) + 'FIXED' : 'q'.repeat(600)
    })
    const validate = (raw: string): RetryValidation =>
      raw.includes('FIXED') ? valid(raw) : invalid(raw, `error-${call}`)
    await runValidationRetryLoop(invalid('c', 'error-0'), {
      models: ['m'],
      prompt: 'p',
      generate,
      validate,
    })
    // first attempt gets the initial error, second gets the error from attempt 1
    expect(errorsSeen[0]).toBe('error-0')
    expect(errorsSeen[1]).toBe('error-1')
  })

  it('skips an attempt when generate throws (API error) and continues', async () => {
    let call = 0
    const generate = vi.fn(async () => {
      call++
      if (call === 1) throw new Error('rate limit')
      return 'w'.repeat(600) + 'FIXED'
    })
    const r = await runValidationRetryLoop(invalid(), {
      models: ['m1', 'm2'],
      prompt: 'p',
      generate,
      validate: validateOnFixed,
    })
    expect(r.recovered).toBe(true)
    expect(r.attempts).toBe(2)
  })

  it('skips output below minLength', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce('short') // < 500 → skipped
      .mockResolvedValueOnce('v'.repeat(600) + 'FIXED')
    const r = await runValidationRetryLoop(invalid(), {
      models: ['m1', 'm2'],
      prompt: 'p',
      generate,
      validate: validateOnFixed,
    })
    expect(r.recovered).toBe(true)
    expect(r.attempts).toBe(2)
  })

  it('does nothing if already valid', async () => {
    const generate = vi.fn()
    const r = await runValidationRetryLoop(valid(), {
      models: ['m'],
      prompt: 'p',
      generate,
      validate: validateOnFixed,
    })
    expect(r.recovered).toBe(true)
    expect(r.attempts).toBe(0)
    expect(generate).not.toHaveBeenCalled()
  })

  it('respects a custom maxRetries', async () => {
    const generate = vi.fn().mockResolvedValue('n'.repeat(600))
    const r = await runValidationRetryLoop(invalid(), {
      maxRetries: 1,
      models: ['m'],
      prompt: 'p',
      generate,
      validate: validateOnFixed,
    })
    expect(r.attempts).toBe(1)
  })
})

describe('buildRepairPrompt', () => {
  it('includes the prompt and the error', () => {
    const out = buildRepairPrompt('build a todo app', 'Unexpected token')
    expect(out).toMatch(/build a todo app/)
    expect(out).toMatch(/Unexpected token/)
    expect(out).toMatch(/```jsx/)
  })
})
