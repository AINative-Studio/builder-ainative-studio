import { describe, it, expect, vi, beforeEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they
// must be set BEFORE the import executes. vi.hoisted() runs above imports.
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

const h = vi.hoisted(() => ({ listGenerations: vi.fn(), isQualityApp: vi.fn() }))
vi.mock('@/lib/zerodb-store', () => ({ listGenerations: h.listGenerations }))
vi.mock('@/lib/showcase-quality', () => ({ isQualityApp: h.isQualityApp }))

import { resolveShowcaseOnlyBySlug } from '@/lib/build/app-registry'

/**
 * #2126 follow-up: `resolveShowcaseOnlyBySlug` is the public /build/{slug}
 * page's second-chance resolver for a real, never-registered showcase
 * generation (see that function's own doc comment, and app-registry.ts's
 * `resolveAppVerified`). It must mirror /api/showcase's own filters and
 * exact slug synthesis (`generateSlug(title) + '-' + chatId.slice(0,6)`) so
 * it only ever resolves a slug to something already publicly listed there.
 */
describe('resolveShowcaseOnlyBySlug (#2126 follow-up)', () => {
  beforeEach(() => {
    h.listGenerations.mockReset()
    h.isQualityApp.mockReset()
    h.isQualityApp.mockReturnValue(true)
  })

  it('resolves a slug matching a real, showcase-flagged generation', async () => {
    h.listGenerations.mockResolvedValueOnce([
      { chat_id: 'pHi9MhemVNRfZdDv8cV85', title: 'Quill', prompt: 'a real idea', generated_code: 'code', is_showcase: true },
    ])
    const result = await resolveShowcaseOnlyBySlug('quill-pHi9Mh')
    expect(result).toEqual({ chatId: 'pHi9MhemVNRfZdDv8cV85', name: 'Quill', idea: 'a real idea' })
  })

  it('treats a row with is_showcase undefined (legacy) the same as true', async () => {
    h.listGenerations.mockResolvedValueOnce([
      { chat_id: 'pHi9MhemVNRfZdDv8cV85', title: 'Quill', prompt: 'a real idea', generated_code: 'code' },
    ])
    const result = await resolveShowcaseOnlyBySlug('quill-pHi9Mh')
    expect(result?.chatId).toBe('pHi9MhemVNRfZdDv8cV85')
  })

  it('returns null when no row matches the slug', async () => {
    h.listGenerations.mockResolvedValueOnce([
      { chat_id: 'pHi9MhemVNRfZdDv8cV85', title: 'Quill', prompt: 'a real idea', generated_code: 'code', is_showcase: true },
    ])
    const result = await resolveShowcaseOnlyBySlug('never-existed')
    expect(result).toBeNull()
  })

  it('excludes a row explicitly flagged is_showcase: false', async () => {
    h.listGenerations.mockResolvedValueOnce([
      { chat_id: 'pHi9MhemVNRfZdDv8cV85', title: 'Quill', prompt: 'a real idea', generated_code: 'code', is_showcase: false },
    ])
    const result = await resolveShowcaseOnlyBySlug('quill-pHi9Mh')
    expect(result).toBeNull()
  })

  it('excludes a row that fails the isQualityApp structural check', async () => {
    h.isQualityApp.mockReturnValue(false)
    h.listGenerations.mockResolvedValueOnce([
      { chat_id: 'pHi9MhemVNRfZdDv8cV85', title: 'Quill', prompt: 'a real idea', generated_code: 'code', is_showcase: true },
    ])
    const result = await resolveShowcaseOnlyBySlug('quill-pHi9Mh')
    expect(result).toBeNull()
  })

  it('excludes a row whose title is an unsubstituted template placeholder (#960 class)', async () => {
    h.listGenerations.mockResolvedValueOnce([
      { chat_id: 'pHi9MhemVNRfZdDv8cV85', title: '{companyName}', prompt: 'a real idea', generated_code: 'code', is_showcase: true },
    ])
    const result = await resolveShowcaseOnlyBySlug('-pHi9Mh')
    expect(result).toBeNull()
  })

  it('returns null for an empty slug without querying ZeroDB', async () => {
    const result = await resolveShowcaseOnlyBySlug('')
    expect(result).toBeNull()
    expect(h.listGenerations).not.toHaveBeenCalled()
  })

  it('fails closed to null when listGenerations throws', async () => {
    h.listGenerations.mockRejectedValueOnce(new Error('ZeroDB down'))
    const result = await resolveShowcaseOnlyBySlug('quill-pHi9Mh')
    expect(result).toBeNull()
  })
})
