// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { getOrCreateAnonDraftToken } from '@/lib/build/anon-draft-token'

describe('getOrCreateAnonDraftToken (#E3.4)', () => {
  beforeEach(() => {
    document.cookie = 'ainative_anon_draft=; path=/; max-age=0'
  })

  it('creates a new random token and stores it as a cookie', () => {
    const token = getOrCreateAnonDraftToken()
    expect(token).toMatch(/^[a-z0-9-]{10,}$/i)
    expect(document.cookie).toContain('ainative_anon_draft=')
  })

  it('returns the SAME token on a second call (reads the existing cookie, never regenerates)', () => {
    const first = getOrCreateAnonDraftToken()
    const second = getOrCreateAnonDraftToken()
    expect(second).toBe(first)
  })
})
