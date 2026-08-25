import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #57 — builder profile validation + core persistence.
 *   - validateProfileInput: pure, no I/O — trims, canonicalizes, field errors.
 *   - profileFromCoreMe: maps a core /auth/me payload → builder profile.
 *   - updateCoreProfile: read-merges preferences, PATCHes /auth/me, never clobbers.
 */
const h = vi.hoisted(() => ({ ainativeFetch: vi.fn() }))
vi.mock('@/lib/ainative/client', () => ({ ainativeFetch: h.ainativeFetch }))

import {
  validateProfileInput,
  profileFromCore,
  updateCoreProfile,
  loadCoreProfile,
} from '@/lib/build/profile'
import { AINativeApiError } from '@/lib/ainative/types'

describe('validateProfileInput (#57)', () => {
  it('accepts a valid profile and trims + canonicalizes', () => {
    const r = validateProfileInput({
      fullName: '  Ada Lovelace  ',
      email: '  ada@example.com ',
      social: '  @ada_l ',
      contentLanguage: 'es',
    })
    expect(r.ok).toBe(true)
    expect(r.value).toEqual({
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      social: 'ada_l', // leading @ stripped for canonical storage
      contentLanguage: 'es',
    })
  })

  it('requires a full name', () => {
    const r = validateProfileInput({ fullName: '   ', email: 'a@b.co', contentLanguage: 'en' })
    expect(r.ok).toBe(false)
    expect(r.errors?.fullName).toBeTruthy()
  })

  it('requires a valid email', () => {
    expect(validateProfileInput({ fullName: 'A', email: '', contentLanguage: 'en' }).errors?.email).toBeTruthy()
    expect(validateProfileInput({ fullName: 'A', email: 'not-an-email', contentLanguage: 'en' }).errors?.email).toBeTruthy()
  })

  it('treats social as optional (empty is fine)', () => {
    const r = validateProfileInput({ fullName: 'A', email: 'a@b.co', contentLanguage: 'en' })
    expect(r.ok).toBe(true)
    expect(r.value?.social).toBe('')
  })

  it('rejects a malformed social handle', () => {
    const r = validateProfileInput({ fullName: 'A', email: 'a@b.co', social: 'has spaces!', contentLanguage: 'en' })
    expect(r.ok).toBe(false)
    expect(r.errors?.social).toBeTruthy()
  })

  it('normalizes an unknown content language to the default (never an error)', () => {
    const r = validateProfileInput({ fullName: 'A', email: 'a@b.co', contentLanguage: 'klingon' })
    expect(r.ok).toBe(true)
    expect(r.value?.contentLanguage).toBe('en')
  })

  it('rejects an over-long name', () => {
    const r = validateProfileInput({ fullName: 'x'.repeat(200), email: 'a@b.co', contentLanguage: 'en' })
    expect(r.ok).toBe(false)
    expect(r.errors?.fullName).toBeTruthy()
  })

  it('tolerates a non-object input', () => {
    const r = validateProfileInput(null)
    expect(r.ok).toBe(false)
    expect(r.errors?.fullName).toBeTruthy()
    expect(r.errors?.email).toBeTruthy()
  })
})

describe('profileFromCore (#57)', () => {
  it('maps full_name from identity and social/language from the prefs blob', () => {
    const p = profileFromCore(
      { email: 'ada@x.com', full_name: 'Ada L' },
      { social: 'ada_l', content_language: 'es' },
    )
    expect(p).toEqual({ fullName: 'Ada L', email: 'ada@x.com', social: 'ada_l', contentLanguage: 'es' })
  })

  it('prefers a founder-set contact_email over the login email', () => {
    const p = profileFromCore({ email: 'login@x.com' }, { contact_email: 'contact@x.com' })
    expect(p.email).toBe('contact@x.com')
  })

  it('falls back to username when full_name absent, and defaults language', () => {
    const p = profileFromCore({ email: 'a@x.com', username: 'ada' }, {})
    expect(p.fullName).toBe('ada')
    expect(p.contentLanguage).toBe('en')
    expect(p.social).toBe('')
  })

  it('tolerates null/empty payloads', () => {
    const p = profileFromCore(null, null)
    expect(p).toEqual({ fullName: '', email: '', social: '', contentLanguage: 'en' })
  })
})

describe('loadCoreProfile (#57)', () => {
  beforeEach(() => h.ainativeFetch.mockReset())

  it('throws 401 without a token', async () => {
    await expect(loadCoreProfile('')).rejects.toBeInstanceOf(AINativeApiError)
  })

  it('reads /auth/me + /users/me/preferences and merges them', async () => {
    // Sequential: 1st call = /auth/me, 2nd = /users/me/preferences.
    h.ainativeFetch
      .mockResolvedValueOnce({ email: 'a@x.com', full_name: 'A' })
      .mockResolvedValueOnce({ preferences: { content_language: 'fr', social: 'a_h' } })
    const p = await loadCoreProfile('tok')
    expect(p.contentLanguage).toBe('fr')
    expect(p.social).toBe('a_h')
    expect(p.fullName).toBe('A')
  })

  it('degrades gracefully when the preferences read fails', async () => {
    // 1st call (/auth/me) resolves; 2nd call (prefs) rejects → caught internally.
    h.ainativeFetch
      .mockResolvedValueOnce({ email: 'a@x.com', full_name: 'A' })
      .mockRejectedValueOnce(new AINativeApiError('prefs down', 500))
    const p = await loadCoreProfile('tok')
    expect(p.fullName).toBe('A')
    expect(p.contentLanguage).toBe('en') // default when prefs unavailable
  })
})

describe('updateCoreProfile (#57)', () => {
  beforeEach(() => h.ainativeFetch.mockReset().mockResolvedValue({}))

  it('throws 401 without a token', async () => {
    await expect(updateCoreProfile('', { fullName: 'A', email: 'a@b.co', social: '', contentLanguage: 'en' }))
      .rejects.toBeInstanceOf(AINativeApiError)
    expect(h.ainativeFetch).not.toHaveBeenCalled()
  })

  it('PUTs the name to /auth/me/profile and PATCHes settings to the prefs blob', async () => {
    await updateCoreProfile('tok', { fullName: 'Ada', email: 'ada@x.com', social: 'ada_l', contentLanguage: 'es' })

    const putCall = h.ainativeFetch.mock.calls.find((c) => c[0] === '/api/v1/auth/me/profile')
    expect(putCall).toBeTruthy()
    expect(putCall![2].method).toBe('PUT')
    expect(putCall![2].body).toEqual({ full_name: 'Ada' })

    const patchCall = h.ainativeFetch.mock.calls.find((c) => c[0] === '/api/v1/users/me/preferences')
    expect(patchCall).toBeTruthy()
    expect(patchCall![2].method).toBe('PATCH')
    expect(patchCall![2].body).toEqual({ content_language: 'es', social: 'ada_l', contact_email: 'ada@x.com' })
  })

  it('propagates a core write failure', async () => {
    h.ainativeFetch.mockRejectedValueOnce(new AINativeApiError('name too long', 422))
    await expect(updateCoreProfile('tok', { fullName: 'A', email: 'a@b.co', social: '', contentLanguage: 'en' }))
      .rejects.toMatchObject({ status: 422 })
  })
})
