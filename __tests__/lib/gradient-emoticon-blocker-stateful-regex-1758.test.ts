import { describe, it, expect } from 'vitest'
import { hasGradients, findGradients, stripGradients } from '@/lib/gradient-blocker'
import { hasEmoticons, findEmoticons, stripEmoticons } from '@/lib/emoticon-blocker'

/**
 * Regression (#1758): hasGradients/hasEmoticons call .test() on module-level
 * singleton /g (/gu) regexes. That's stateful across calls — a match leaves
 * lastIndex pointing past it, so the NEXT call (on a different code string)
 * silently resumes scanning from there instead of index 0, missing a real
 * match that occurs earlier in that string. Each call below must be
 * independent of whatever ran before it in the same process.
 */

describe('hasGradients does not leak lastIndex across calls (#1758)', () => {
  it('detects a gradient on the second call even after a prior call matched past it', () => {
    expect(hasGradients('<div className="bg-gradient-to-r from-blue-500 to-pink-500">')).toBe(true)
    // Second, unrelated string whose only gradient class sits before where
    // the shared regex's lastIndex was left after the call above.
    expect(hasGradients('<div className="bg-gradient-to-l"> some padding content here </div>')).toBe(true)
  })

  it('stays correct across many interleaved calls regardless of order', () => {
    const withGradient = '<span className="from-purple-600">x</span>'
    const withoutGradient = '<span className="text-slate-900">plain</span>'
    for (let i = 0; i < 5; i++) {
      expect(hasGradients(withGradient)).toBe(true)
      expect(hasGradients(withoutGradient)).toBe(false)
    }
  })

  it('findGradients/stripGradients remain correct regardless of hasGradients call order', () => {
    hasGradients('<div className="bg-gradient-to-r">') // pollute lastIndex before the real check
    const code = '<div className="via-pink-500">content</div>'
    expect(findGradients(code)).toEqual(['via-pink-500'])
    expect(stripGradients(code)).not.toContain('via-pink-500')
  })
})

describe('hasEmoticons does not leak lastIndex across calls (#1758)', () => {
  it('detects an emoticon on the second call even after a prior call matched past it', () => {
    expect(hasEmoticons('Welcome! \u{1F680} Launch your idea today.')).toBe(true)
    expect(hasEmoticons('✅ All set — no code after this emoji in the string.')).toBe(true)
  })

  it('stays correct across many interleaved calls regardless of order', () => {
    const withEmoticon = 'Great job ✔ keep going'
    const withoutEmoticon = 'Great job, keep going'
    for (let i = 0; i < 5; i++) {
      expect(hasEmoticons(withEmoticon)).toBe(true)
      expect(hasEmoticons(withoutEmoticon)).toBe(false)
    }
  })

  it('findEmoticons/stripEmoticons remain correct regardless of hasEmoticons call order', () => {
    hasEmoticons('Done \u{1F680}') // pollute lastIndex before the real check
    const code = 'Status: ✅ complete'
    expect(findEmoticons(code)).toContain('✅')
    expect(stripEmoticons(code)).not.toContain('✅')
  })
})
