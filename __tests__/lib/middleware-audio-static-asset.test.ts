import { describe, it, expect } from 'vitest'
import { config } from '@/middleware'

/**
 * Real bug found live (2026-09-14): the landing page's ambient audio files
 * (public/audio/*.mp3) 307-redirected anonymous visitors to /login instead of
 * serving the file — the middleware matcher's static-asset exclusion list
 * covered png/jpg/svg/css/js/etc. but had no audio extensions, so /audio/*.mp3
 * fell through to full middleware like any protected page.
 */
describe('middleware matcher excludes audio static assets (2026-09-14)', () => {
  const matcherRegexSource = config.matcher.find((m) => typeof m === 'string' && m.startsWith('/((?!'))
  if (!matcherRegexSource) throw new Error('expected the negative-lookahead static-asset matcher entry')
  // Next's matcher strings are path-to-regexp patterns; the leading '/' + the
  // (?!...) group behaves as a real RegExp against a pathname once anchored.
  const matcherRegex = new RegExp(`^${matcherRegexSource}$`)

  it('does NOT match landing page audio files (they must bypass middleware)', () => {
    expect(matcherRegex.test('/audio/cody-space-drone-loop.mp3')).toBe(false)
    expect(matcherRegex.test('/audio/cody-beam-sweep.mp3')).toBe(false)
    expect(matcherRegex.test('/audio/cody-landing-8bit.mp3')).toBe(false)
    expect(matcherRegex.test('/audio/cody-landing-soft.mp3')).toBe(false)
  })

  it('still matches real protected/dynamic paths (regression guard)', () => {
    expect(matcherRegex.test('/')).toBe(true)
    expect(matcherRegex.test('/login')).toBe(true)
    expect(matcherRegex.test('/api/build/ask')).toBe(true)
  })

  it('still excludes the other static asset extensions unaffected by this fix', () => {
    expect(matcherRegex.test('/logo.png')).toBe(false)
    expect(matcherRegex.test('/styles.css')).toBe(false)
    expect(matcherRegex.test('/bundle.js')).toBe(false)
  })
})
