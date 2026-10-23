import { describe, it, expect } from 'vitest'
import { buildSeedPayload } from '@/e2e/helpers/session-restore'
import { buildStateStorageKey } from '@/contexts/build-context'

/**
 * #1198 — unit coverage for the gated E2E session-restore seam's PURE
 * payload builder (no Playwright/DOM involved; browser-level integration is
 * e2e/session-restore.spec.ts). Guards the one thing that would silently
 * defeat the whole seam: a payload shape that doesn't match what
 * contexts/build-context.tsx's own loadBuildState/isSavedBuildStateComplete
 * actually expect to read back.
 */
describe('buildSeedPayload (#1198 session-restore seam)', () => {
  it('marks a company-track fixture as a genuinely completed build (builtCompany true, not builtMVP)', () => {
    const payload = buildSeedPayload({ slug: 'acme-roofing' })
    expect(payload.track).toBe('company')
    expect(payload.builtCompany).toBe(true)
    expect(payload.builtMVP).toBe(false)
  })

  it('marks an app-track fixture as builtMVP, not builtCompany', () => {
    const payload = buildSeedPayload({ slug: 'acme-app', track: 'app' })
    expect(payload.track).toBe('app')
    expect(payload.builtMVP).toBe(true)
    expect(payload.builtCompany).toBe(false)
  })

  it('marks every one of that track\'s real artifact views as generated+done — isSavedBuildStateComplete only trusts a FULLY finished cache', () => {
    const payload = buildSeedPayload({ slug: 'acme-roofing' })
    const companyViews = ['design', 'thesis', 'wedge', 'businessModel', 'positioning', 'landing', 'plan30']
    for (const v of companyViews) {
      // `generated` holds real artifact CONTENT (Record<string, unknown>),
      // `done` holds a real status STRING ('done') — see lib/build/state.ts's
      // COMPLETE_ARTIFACT reducer case, not booleans.
      expect(payload.generated[v]).toBeTruthy()
      expect(payload.done[v]).toBe('done')
    }
  })

  it('carries the real appSub/companyName/idea identity the Live dashboard reads companyId from', () => {
    const payload = buildSeedPayload({
      slug: 'acme-roofing',
      companyName: 'Acme Roofing',
      idea: 'A CRM for roofing contractors',
    })
    expect(payload.appSub).toBe('acme-roofing')
    expect(payload.companyName).toBe('Acme Roofing')
    expect(payload.idea).toBe('A CRM for roofing contractors')
  })

  it('defaults companyName to the slug when not supplied, never leaving it blank', () => {
    const payload = buildSeedPayload({ slug: 'acme-roofing' })
    expect(payload.companyName).toBe('acme-roofing')
  })

  it('carries a real registered appChatId/productChatId when the fixture supplies one — the field isSavedBuildStateComplete requires to trust a cache without a network round-trip', () => {
    const payload = buildSeedPayload({
      slug: 'acme-roofing',
      appChatId: 'real-chat-id-123',
    })
    expect(payload.appChatId).toBe('real-chat-id-123')
  })

  it('round-trips through JSON exactly the way localStorage.setItem/getItem does', () => {
    const payload = buildSeedPayload({ slug: 'acme-roofing', appChatId: 'chat-1' })
    const roundTripped = JSON.parse(JSON.stringify(payload))
    expect(roundTripped).toEqual(payload)
  })

  it('writes under the same key loadBuildState/saveBuildState use for this slug', () => {
    expect(buildStateStorageKey('acme-roofing')).toBe('ainative_build_acme-roofing')
  })
})
