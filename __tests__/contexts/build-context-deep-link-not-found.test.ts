import { describe, it, expect } from 'vitest'
import { isDeepLinkCompanyNotFound } from '@/contexts/build-context'

/**
 * Real bug: a ?screen=live&company=<slug> deep link whose slug doesn't match
 * any registered company was trusted blindly — the deep-link-restore effect
 * dispatches START_BUILD with idea/appSub/companyName all set to the raw
 * slug string itself, no server round-trip. That pre-populates state.idea,
 * which defeats Live.tsx's OWN idea-hydration effect (it only ever runs
 * `if (!state.idea)`), so nothing ever independently confirms the company is
 * real. The founder's session proceeds normally right up until some other
 * slug-scoped call (confirmed live: /api/build/connect-domain) 404s with a
 * bare "company not found" and no context for why.
 *
 * Reported symptom: Builder's "connect a domain" flow said "company not
 * found" for a real, live company. Traced to this — the founder's URL/slug
 * had drifted from the real registered one (stale bookmark / rename), not a
 * bug in domain-connect or a specific DNS provider (Cloudflare/Namecheap/
 * GoDaddy all send the identical slug-scoped request; the bug is upstream of
 * any registrar-specific code).
 */
describe('isDeepLinkCompanyNotFound', () => {
  it('flags a slug that resolve-app confirms was never registered (no chatId, no idea)', () => {
    expect(isDeepLinkCompanyNotFound({ chatId: null, idea: null })).toBe(true)
  })

  it('does NOT flag a real, registered company with a chatId', () => {
    expect(isDeepLinkCompanyNotFound({ chatId: 'real-chat-id', idea: 'a real idea' })).toBe(false)
  })

  it('does NOT flag a real company mid-registration that has a chatId but no idea saved yet', () => {
    expect(isDeepLinkCompanyNotFound({ chatId: 'real-chat-id', idea: null })).toBe(false)
  })

  it('does NOT flag when idea is present even without chatId (never actually happens via resolve-app, but must not false-positive)', () => {
    expect(isDeepLinkCompanyNotFound({ chatId: null, idea: 'some idea' })).toBe(false)
  })

  it('fails open (does not flag) on a network/parse failure — never wrongly tells a founder their real company is missing', () => {
    expect(isDeepLinkCompanyNotFound(null)).toBe(false)
  })
})
