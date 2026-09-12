import { describe, it, expect } from 'vitest'
import { computeSyncedUrl } from '@/contexts/build-context'

/**
 * Real bug found live (#648): navigating client-side via GOTO_SCREEN (My
 * Portfolio, Live, etc.) never updated the browser's URL — only the
 * workspace screen's own ?view= param was ever kept in sync (#285). A
 * reload re-ran the app's one-shot deep-link-restore effect against
 * whatever ?screen= happened to be in the URL from the very FIRST
 * navigation (e.g. the auth redirect's own ?screen=login), silently
 * bouncing a founder who'd long since moved to My Portfolio back to that
 * stale screen. Confirmed live via Playwright: reload from My Portfolio
 * landed back on the raw login form.
 *
 * computeSyncedUrl is the pure decision behind the fix — given the current
 * URL and the screen the app is ACTUALLY on, what should the URL become.
 */
describe('computeSyncedUrl (#648)', () => {
  it('updates a stale ?screen= to the current screen', () => {
    const next = computeSyncedUrl('https://x.test/build?screen=login', 'companies')
    expect(next).not.toBeNull()
    expect(new URL(next!).searchParams.get('screen')).toBe('companies')
  })

  it('returns null (no change needed) when the URL already matches the current screen and has no stale company/view', () => {
    const next = computeSyncedUrl('https://x.test/build?screen=companies', 'companies')
    expect(next).toBeNull()
  })

  it('clears a stale ?company= when landing on a screen with no company context (the exact #648 hazard)', () => {
    // A founder who visited a Live dashboard (?company=ember-box), then
    // navigated to My Portfolio client-side — the URL still says
    // ?company=ember-box until this fix. Left alone, a reload's deep-link
    // effect would see `company` truthy and silently START_BUILD for
    // ember-box again, even though ?screen=companies has nothing to do with
    // any one company.
    const next = computeSyncedUrl('https://x.test/build?screen=live&company=ember-box', 'companies')
    expect(next).not.toBeNull()
    const u = new URL(next!)
    expect(u.searchParams.get('screen')).toBe('companies')
    expect(u.searchParams.has('company')).toBe(false)
  })

  it('clears a stale ?view= alongside ?company= on a company-context-free screen', () => {
    const next = computeSyncedUrl('https://x.test/build?screen=ws&company=ember-box&view=prd', 'account')
    const u = new URL(next!)
    expect(u.searchParams.has('company')).toBe(false)
    expect(u.searchParams.has('view')).toBe(false)
    expect(u.searchParams.get('screen')).toBe('account')
  })

  it('keeps ?company= intact when moving between two build-flow screens that both need it', () => {
    const next = computeSyncedUrl('https://x.test/build?screen=ws&company=ember-box', 'live')
    const u = new URL(next!)
    expect(u.searchParams.get('screen')).toBe('live')
    expect(u.searchParams.get('company')).toBe('ember-box')
  })

  it('never touches unrelated query params (e.g. gclid/utm attribution)', () => {
    const next = computeSyncedUrl('https://x.test/build?screen=login&gclid=abc123', 'companies')
    const u = new URL(next!)
    expect(u.searchParams.get('gclid')).toBe('abc123')
  })

  it('landing screen also clears stale company/view (the same hazard as My Portfolio)', () => {
    const next = computeSyncedUrl('https://x.test/build?screen=ws&company=ember-box&view=prd', 'landing')
    const u = new URL(next!)
    expect(u.searchParams.has('company')).toBe(false)
    expect(u.searchParams.has('view')).toBe(false)
  })
})
