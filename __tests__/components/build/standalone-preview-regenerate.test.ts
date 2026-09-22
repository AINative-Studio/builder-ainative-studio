import { describe, it, expect } from 'vitest'
import { planRegenerate, baseSlugOf } from '@/components/build/StandalonePreviewRegenerate'

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
