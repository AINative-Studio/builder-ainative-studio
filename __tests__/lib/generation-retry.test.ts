import { describe, it, expect, vi } from 'vitest'
import {
  runValidationRetryLoop,
  buildRepairPrompt,
  parseErrorLine,
  extractErrorWindow,
  type RetryValidation,
} from '@/lib/generation-retry'
import { validateGeneratedCode } from '@/lib/code-validator'

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

  it('adds a targeted backtick-fix instruction for an unterminated template error (#531)', () => {
    const out = buildRepairPrompt('build a community feed', 'Unterminated template. at line 734, column 3')
    expect(out).toMatch(/UNTERMINATED TEMPLATE LITERAL/)
    expect(out).toMatch(/backtick/i)
  })

  it('does not add the template hint for an unrelated error', () => {
    const out = buildRepairPrompt('build x', 'Element type is invalid: <Foo> is used but not defined')
    expect(out).not.toMatch(/UNTERMINATED TEMPLATE LITERAL/)
  })
})

/**
 * Regression (#531): a real production generation failed with "Unterminated
 * template. at line 734, column 3" on a multi-file "community platform with
 * member groups and a social feed" build, and every repair attempt (retry loop
 * + Claude agent fallback) failed to fix it. Root cause: both repair prompts
 * sliced the broken code with a flat `slice(0, N)` prefix cutoff — for any
 * generation whose real error lands past that char offset (trivial for a
 * 700+ line multi-file payload), the repair model was handed code that never
 * contained the actual defect, so it had nothing to fix.
 */
describe('parseErrorLine (#531)', () => {
  it('extracts the line number from a code-validator error string', () => {
    expect(parseErrorLine('Unterminated template. at line 734, column 3')).toBe(734)
    expect(parseErrorLine('Unexpected token at line 12, column 5')).toBe(12)
  })

  it('returns null when there is no line number', () => {
    expect(parseErrorLine('Element type is invalid: <Foo> is used but not defined')).toBeNull()
    expect(parseErrorLine('')).toBeNull()
  })
})

describe('extractErrorWindow (#531)', () => {
  /** Build a large multi-line source with a real unterminated template at `errorLine`. */
  function buildBrokenSource(totalLines: number, errorLine: number): string {
    const lines: string[] = []
    for (let i = 1; i <= totalLines; i++) {
      if (i === errorLine) {
        // Deliberately unterminated — no closing backtick.
        lines.push(`  const label${i} = \`Community Feed - ${'${posts.length}'} posts;`)
      } else {
        lines.push(`function Helper${i}() { return <div className="p-2">Helper ${i}</div> }`)
      }
    }
    return lines.join('\n')
  }

  it('keeps the error line in view even when it is far past a flat 8000-char prefix', () => {
    const code = buildBrokenSource(1000, 734)
    const errorMarkerLine = code.split('\n')[733]
    // Sanity: the naive flat slice used to lose this line entirely.
    expect(code.slice(0, 8000)).not.toContain(errorMarkerLine)

    const validation = validateGeneratedCode(code)
    expect(validation.valid).toBe(false)
    expect(validation.error).toMatch(/at line 734/)

    const windowed = extractErrorWindow(code, validation.error!, 8000)
    expect(windowed).toContain(errorMarkerLine)
  })

  it('respects the maxChars budget', () => {
    const code = buildBrokenSource(1000, 734)
    const windowed = extractErrorWindow(code, 'Unterminated template. at line 734, column 3', 2000)
    expect(windowed.length).toBeLessThanOrEqual(2000 + 200) // + generous marker-comment slack
  })

  it('falls back to a flat prefix slice when the error has no line number', () => {
    const code = 'a'.repeat(20000)
    const windowed = extractErrorWindow(code, 'Element type is invalid: <Foo> is used but not defined', 8000)
    expect(windowed).toBe(code.slice(0, 8000))
  })

  it('falls back to a flat prefix slice when the code is already within budget', () => {
    const code = 'const x = 1\n'.repeat(50) // well under 8000 chars
    const windowed = extractErrorWindow(code, 'Unterminated template. at line 40, column 3', 8000)
    expect(windowed).toBe(code.slice(0, 8000))
  })

  it('clamps an out-of-range line number to the nearest real line instead of throwing', () => {
    const code = buildBrokenSource(50, 25) // short code, huge reported line number
    expect(() => extractErrorWindow(code, 'Unterminated template. at line 99999, column 3', 100)).not.toThrow()
  })
})
