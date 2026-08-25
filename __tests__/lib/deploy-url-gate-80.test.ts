import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #80 — deployPersistent must NOT return a {slug}.ainative.studio wildcard URL for
 * unpaid/unclaimed companies (that URL just 301s to /build/{slug} per #78). It should
 * return the /build/{slug} path unless the company is paid AND has claimed the subdomain.
 */
describe('#80 deployPersistent subdomain gating', () => {
  const OLD = process.env.AINATIVE_WILDCARD_HOST
  beforeEach(() => { process.env.AINATIVE_WILDCARD_HOST = 'ainative.studio' })
  afterEach(() => { process.env.AINATIVE_WILDCARD_HOST = OLD })

  it('returns /build/{slug} path for an unpaid/unclaimed company (no entry)', async () => {
    const { deployPersistent } = await import('@/lib/build/deploy')
    const t = await deployPersistent('chat1', 'freeco')
    expect(t.url).toContain('/build/freeco')
    expect(t.url).not.toContain('freeco.ainative.studio')
    expect(t.kind).toBe('preview')
  })

  it('returns /build/{slug} for a paid company that has NOT claimed the subdomain', async () => {
    const { deployPersistent } = await import('@/lib/build/deploy')
    const t = await deployPersistent('chat2', 'paidco', { plan: 'pro', subdomainClaimed: false })
    expect(t.url).toContain('/build/paidco')
    expect(t.url).not.toContain('paidco.ainative.studio')
  })

  it('returns the {slug}.ainative.studio wildcard URL only when paid AND claimed', async () => {
    const { deployPersistent } = await import('@/lib/build/deploy')
    const t = await deployPersistent('chat3', 'realco', { plan: 'pro', subdomainClaimed: true })
    expect(t.url).toBe('https://realco.ainative.studio')
    expect(t.kind).toBe('wildcard')
    expect(t.dnsPointable).toBe(true)
  })
})
