import { describe, it, expect } from 'vitest'
import { planRegenerate, baseSlugOf, isAcceptedPreviewMessageOrigin, homeDestination } from '@/components/build/StandalonePreviewRegenerate'

/**
 * Real gap found live (2026-09-21): a founder's real product build
 * (/build/{slug}-product) can fail server-side code validation and serve an
 * honest error page with a real "Regenerate this app" button — but the
 * standalone /build/{slug} page (opened via a shared link, or "Open your
 * product" in a new tab) has no chat/reducer context, so nothing was
 * listening for that button's postMessage at all. Clicking it did nothing.
 *
 * Only the Company track has a real, headless REST endpoint (company-app /
 * company-product, `force: true`) that can retry generation without a live
 * chat/reducer session. The App track's real regeneration path runs through
 * the full chat-ws/reducer flow inside the dashboard (Preview.tsx already
 * handles this correctly, #310) — there's no headless equivalent to call
 * from a bare standalone page, so that case must honestly redirect the
 * founder back into the dashboard rather than silently doing nothing.
 */
describe('baseSlugOf', () => {
  it('strips a -product suffix', () => {
    expect(baseSlugOf('agentive-product')).toBe('agentive')
  })
  it('leaves a plain slug unchanged', () => {
    expect(baseSlugOf('agentive')).toBe('agentive')
  })
})

describe('planRegenerate', () => {
  it('Company-track product slug with a real idea: calls company-product with force:true', () => {
    const plan = planRegenerate({ slug: 'agentive-product', idea: 'a real idea', track: 'company', name: 'Agentive' })
    expect(plan.kind).toBe('call')
    if (plan.kind !== 'call') throw new Error('expected call')
    expect(plan.endpoint).toBe('/api/build/company-product')
    expect(plan.body).toEqual({ idea: 'a real idea', slug: 'agentive', name: 'Agentive', force: true })
  })

  it('Company-track landing-page slug (no -product suffix) with a real idea: calls company-app with force:true', () => {
    const plan = planRegenerate({ slug: 'agentive', idea: 'a real idea', track: 'company', name: 'Agentive' })
    expect(plan.kind).toBe('call')
    if (plan.kind !== 'call') throw new Error('expected call')
    expect(plan.endpoint).toBe('/api/build/company-app')
    expect(plan.body).toEqual({ idea: 'a real idea', slug: 'agentive', name: 'Agentive', force: true })
  })

  it('App track (no headless regen path): redirects into the real dashboard instead of a dead click', () => {
    const plan = planRegenerate({ slug: 'someapp', idea: 'a real idea', track: 'app', name: 'SomeApp' })
    expect(plan.kind).toBe('redirect')
    if (plan.kind !== 'redirect') throw new Error('expected redirect')
    expect(plan.url).toBe('/build?screen=live&company=someapp')
  })

  it('Company track but no idea available at all: redirects rather than calling an endpoint with an empty idea', () => {
    const plan = planRegenerate({ slug: 'agentive-product', idea: undefined, track: 'company', name: 'Agentive' })
    expect(plan.kind).toBe('redirect')
  })

  it('unknown/missing track: redirects (fails toward the safe path, never assumes company)', () => {
    const plan = planRegenerate({ slug: 'agentive-product', idea: 'a real idea', track: undefined, name: 'Agentive' })
    expect(plan.kind).toBe('redirect')
  })

  it('falls back to the base slug as the name when no name is given', () => {
    const plan = planRegenerate({ slug: 'agentive-product', idea: 'a real idea', track: 'company' })
    if (plan.kind !== 'call') throw new Error('expected call')
    expect(plan.body.name).toBe('agentive')
  })

  it('redirect URL encodes the slug safely', () => {
    const plan = planRegenerate({ slug: 'a company/weird', idea: undefined, track: undefined })
    if (plan.kind !== 'redirect') throw new Error('expected redirect')
    expect(plan.url).toBe('/build?screen=live&company=a%20company%2Fweird')
  })
})

/**
 * Real bug fixed live 2026-09-22, found ONLY by a real Playwright click (an
 * API-level check of the same fix would never have caught this): the
 * standalone page's iframe includes `allow-same-origin` in its sandbox
 * attribute (unlike Preview.tsx's dashboard iframe, which doesn't), so it
 * posts messages with the real page origin, not "null". The original check
 * (`e.origin !== 'null'`) silently discarded every real message — confirmed
 * live: clicking "Regenerate" flipped the button's own inline-script text to
 * "Rebuilding…" (the iframe's own script ran fine) but the parent page never
 * received the message at all, so no rebuild was ever actually triggered.
 */
describe('isAcceptedPreviewMessageOrigin', () => {
  it('accepts "null" (a sandboxed iframe WITHOUT allow-same-origin — e.g. Preview.tsx\'s dashboard iframe)', () => {
    expect(isAcceptedPreviewMessageOrigin('null', 'https://builder.ainative.studio')).toBe(true)
  })

  it('accepts the real page origin (a sandboxed iframe WITH allow-same-origin — the standalone page\'s own iframe)', () => {
    expect(isAcceptedPreviewMessageOrigin('https://builder.ainative.studio', 'https://builder.ainative.studio')).toBe(true)
  })

  it('rejects a genuinely different origin (never trust an arbitrary cross-origin postMessage)', () => {
    expect(isAcceptedPreviewMessageOrigin('https://evil.example.com', 'https://builder.ainative.studio')).toBe(false)
  })
})

/**
 * #866 (2026-09-24): the "Preview Unavailable" error page's ONLY buttons are
 * "Start New Chat" (posts { action: 'home' }) and "Try Again" (reload) — for
 * a founder whose generation is genuinely, permanently broken (#865), the
 * bare homepage was a dead end with no path back to their own dashboard.
 * Confirmed live: evan@ainative.studio's flashpoint registry entry stayed
 * stale (plan: null, keyKind: tmp) through a real logout/login specifically
 * because this page never routes back to Live.tsx, the only place plan
 * reconciliation runs.
 */
describe('homeDestination', () => {
  it('routes to this company\'s own Live dashboard when a slug is known', () => {
    expect(homeDestination('flashpoint')).toBe('/build?screen=live&company=flashpoint')
  })

  it('strips a -product suffix so a product-page slug still lands on its base company', () => {
    expect(homeDestination('agentive-product')).toBe('/build?screen=live&company=agentive')
  })

  it('falls back to the bare homepage only when there is genuinely no slug', () => {
    expect(homeDestination(undefined)).toBe('/')
    expect(homeDestination('')).toBe('/')
    expect(homeDestination('   ')).toBe('/')
  })

  it('encodes the slug safely', () => {
    expect(homeDestination('a company/weird')).toBe('/build?screen=live&company=a%20company%2Fweird')
  })
})
