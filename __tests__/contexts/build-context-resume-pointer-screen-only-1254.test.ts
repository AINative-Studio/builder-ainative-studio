import { describe, it, expect } from 'vitest'
import { shouldResumeFromPointer, isExplicitScreenOnlyDeepLink } from '@/contexts/build-context'

/**
 * builder#1254 — "company not appearing" sibling bug: navigating directly to
 * `/build?screen=companies` (bookmark, shared link, typed URL) silently
 * landed back in whatever workspace was active client-side instead of the
 * companies list.
 *
 * Root cause: isExplicitCompanyDeepLink only protects a `?screen=&company=`
 * PAIR from the #669 resume-pointer effect. `?screen=companies` has no
 * `company=` (the index screen isn't company-scoped), so it was never
 * recognized as an explicit destination — and 'companies' sits in
 * RESUMABLE_ENTRY_SCREENS (deliberately, for the bare-reload/"arrived here
 * with no destination of its own" case), so the pointer effect treated the
 * founder's own explicit URL the same as having no destination at all and
 * overrode it with a stale pointer.
 */
describe('isExplicitScreenOnlyDeepLink (#1254)', () => {
  it('recognizes ?screen=companies with no company= as an explicit destination', () => {
    expect(isExplicitScreenOnlyDeepLink('?screen=companies')).toBe(true)
  })

  it('recognizes ?screen=account and ?screen=refer too', () => {
    expect(isExplicitScreenOnlyDeepLink('?screen=account')).toBe(true)
    expect(isExplicitScreenOnlyDeepLink('?screen=refer')).toBe(true)
  })

  it('does not fire with no ?screen= at all — the bare-reload case stays untouched', () => {
    expect(isExplicitScreenOnlyDeepLink('')).toBe(false)
    expect(isExplicitScreenOnlyDeepLink('?utm_source=email')).toBe(false)
  })

  it('does not claim a company-scoped screen — isExplicitCompanyDeepLink already covers those', () => {
    expect(isExplicitScreenOnlyDeepLink('?screen=ws')).toBe(false)
    expect(isExplicitScreenOnlyDeepLink('?screen=live')).toBe(false)
  })

  it('deliberately does not cover the auth-flow screens — resume-after-login stays intact', () => {
    expect(isExplicitScreenOnlyDeepLink('?screen=login')).toBe(false)
    expect(isExplicitScreenOnlyDeepLink('?screen=landing')).toBe(false)
  })
})

describe('shouldResumeFromPointer (#1254 path)', () => {
  const session = { user: { email: 'founder@ainative.studio' } }
  const pointer = { slug: 'silo', screen: 'ws' }
  const savedStale = { builtCompany: false, appChatId: '' }

  it('REFUSES to resume over an explicit ?screen=companies deep link — the reported bounce', () => {
    expect(shouldResumeFromPointer({
      search: '?screen=companies', pointer, saved: savedStale, session,
    })).toBe(false)
  })

  it('still resumes on a genuinely bare /build load (unchanged #669 behavior)', () => {
    expect(shouldResumeFromPointer({
      search: '', pointer, saved: savedStale, session,
    })).toBe(true)
  })
})
