import { describe, it, expect } from 'vitest'
import { hasGradients } from '@/lib/gradient-blocker'
import { hasEmoticons } from '@/lib/emoticon-blocker'

/**
 * #1758 — hasGradients/hasEmoticons use shared, global-flagged RegExp
 * singletons with `.test()`, which mutates `lastIndex` across calls. A
 * match in one call left `lastIndex` pointing partway through the pattern's
 * own state, so a later, independent call could start scanning from the
 * wrong offset and silently miss a real match.
 */

describe('hasGradients regex lastIndex leak (#1758)', () => {
  it('detects a gradient in a second, independent call after a first call already matched', () => {
    expect(hasGradients('<div className="bg-gradient-to-r">')).toBe(true)
    // Before the fix: lastIndex was left at the end of the first match, so
    // this second call silently returned false.
    expect(hasGradients('<div className="bg-gradient-to-l"> padding content</div>')).toBe(true)
  })

  it('repeated calls on the same matching input stay consistently true', () => {
    const code = '<div className="bg-gradient-to-r from-blue-500 to-purple-600" />'
    expect(hasGradients(code)).toBe(true)
    expect(hasGradients(code)).toBe(true)
    expect(hasGradients(code)).toBe(true)
  })

  it('returns false when there is genuinely no gradient', () => {
    expect(hasGradients('<div className="bg-blue-600" />')).toBe(false)
  })
})

describe('hasEmoticons regex lastIndex leak (#1758)', () => {
  it('detects an emoticon in a second, independent call after a first call already matched', () => {
    expect(hasEmoticons('<p>Great job! ✅</p>')).toBe(true)
    // Before the fix: an earlier match on the check-mark pattern could leave
    // that pattern's lastIndex advanced, silently missing a later ✓-only call.
    expect(hasEmoticons('<p>Status: ✓</p>')).toBe(true)
  })

  it('repeated calls on the same matching input stay consistently true', () => {
    const code = '<p>\u{1F600} hello</p>'
    expect(hasEmoticons(code)).toBe(true)
    expect(hasEmoticons(code)).toBe(true)
    expect(hasEmoticons(code)).toBe(true)
  })

  it('returns false when there is genuinely no emoticon', () => {
    expect(hasEmoticons('<p>Plain text, no icons here.</p>')).toBe(false)
  })
})
