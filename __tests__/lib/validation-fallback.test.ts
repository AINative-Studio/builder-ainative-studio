import { describe, it, expect } from 'vitest'
import {
  buildValidationFallbackComponent,
  escapeForJsxString,
} from '@/lib/validation-fallback'
import { validateJavaScriptCode } from '@/lib/code-validator'

/**
 * builder#77 — the graceful-degradation fallback must ALWAYS be valid, for any
 * prompt (including hostile ones), or degradation would itself break the preview.
 */
describe('validation-fallback (#77)', () => {
  it('produces a component that passes our own validator', () => {
    const src = buildValidationFallbackComponent('Build a todo app')
    const r = validateJavaScriptCode(src)
    expect(r.valid).toBe(true)
  })

  it('stays valid for a prompt with quotes, backticks and ${}', () => {
    const nasty = 'Build `an app` with "quotes" and ${injection} and \'apostrophes\''
    const src = buildValidationFallbackComponent(nasty)
    const r = validateJavaScriptCode(src)
    expect(r.valid).toBe(true)
  })

  it('stays valid for a prompt with newlines and backslashes', () => {
    const nasty = 'line one\nline two\\ with backslash\r\nand more'
    const src = buildValidationFallbackComponent(nasty)
    expect(validateJavaScriptCode(src).valid).toBe(true)
  })

  it('stays valid for an empty / undefined prompt', () => {
    expect(validateJavaScriptCode(buildValidationFallbackComponent('')).valid).toBe(true)
    // @ts-expect-error — exercise the nullish guard
    expect(validateJavaScriptCode(buildValidationFallbackComponent(undefined)).valid).toBe(true)
  })

  it('exports a default App component', () => {
    const src = buildValidationFallbackComponent('x')
    expect(src).toMatch(/export default function App\(\)/)
  })

  describe('escapeForJsxString', () => {
    it('escapes backticks, ${, quotes, backslashes into template-safe form', () => {
      const out = escapeForJsxString('a`b${c}d\\e\'f"g')
      // Every special char is backslash-escaped so the string is safe inside a
      // template literal — the real invariant is "no BARE backtick or ${".
      expect(/(^|[^\\])`/.test(out)).toBe(false) // no un-escaped backtick
      expect(/(^|[^\\])\$\{/.test(out)).toBe(false) // no un-escaped ${
      expect(out).toMatch(/\\`/) // backtick present but escaped
    })
    it('collapses newlines to spaces', () => {
      expect(escapeForJsxString('a\nb\r\nc')).toBe('a b c')
    })
    it('truncates to 200 chars', () => {
      expect(escapeForJsxString('x'.repeat(500)).length).toBeLessThanOrEqual(200)
    })
    it('handles null/undefined safely', () => {
      // @ts-expect-error
      expect(escapeForJsxString(null)).toBe('')
      // @ts-expect-error
      expect(escapeForJsxString(undefined)).toBe('')
    })
  })
})
