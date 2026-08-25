import { describe, it, expect } from 'vitest'
import { wildcardSlugFromHost, wildcardUrl, isPaidPlan, subdomainServable } from '@/lib/build/deploy'

// #243 wildcard host → slug routing. wildcardHost is passed explicitly so the
// tests don't depend on process.env at import time.
const HOST = 'ainative.studio'

describe('wildcardSlugFromHost', () => {
  it('extracts the slug from a company subdomain', () => {
    expect(wildcardSlugFromHost('riff.ainative.studio', HOST)).toBe('riff')
    expect(wildcardSlugFromHost('quibbly-wox.ainative.studio', HOST)).toBe('quibbly-wox')
  })

  it('strips a port from the host', () => {
    expect(wildcardSlugFromHost('riff.ainative.studio:3000', HOST)).toBe('riff')
  })

  it('is case-insensitive on the host', () => {
    expect(wildcardSlugFromHost('Riff.AINative.Studio', HOST)).toBe('riff')
  })

  it('ignores the apex and www', () => {
    expect(wildcardSlugFromHost('ainative.studio', HOST)).toBeNull()
    expect(wildcardSlugFromHost('www.ainative.studio', HOST)).toBeNull()
  })

  it('ignores reserved/infra subdomains (never company slugs)', () => {
    // Companies live on the apex, so our own hosts must NOT be hijacked.
    expect(wildcardSlugFromHost('builder.ainative.studio', HOST)).toBeNull()
    expect(wildcardSlugFromHost('api.ainative.studio', HOST)).toBeNull()
    expect(wildcardSlugFromHost('docs.ainative.studio', HOST)).toBeNull()
    expect(wildcardSlugFromHost('app.ainative.studio', HOST)).toBeNull()
  })

  it('ignores EXISTING sibling apps synced from the live DNS zone', () => {
    // These are real *.ainative.studio apps — must never be rewritten to /build/*.
    for (const sub of ['zerodb', 'chat', 'live', 'aikit', 'agentflow', 'ocean',
                       'community', 'dothack', 'wwmaa', 'zeroinvoice', 'pipeline',
                       'zeropipeline', 'memory', 'agency', 'pillsense', 'boardlens']) {
      expect(wildcardSlugFromHost(`${sub}.ainative.studio`, HOST)).toBeNull()
    }
  })

  it('ignores multi-label subdomains (not a single company slug)', () => {
    expect(wildcardSlugFromHost('a.b.ainative.studio', HOST)).toBeNull()
  })

  it('ignores a different host entirely', () => {
    expect(wildcardSlugFromHost('riff.example.com', HOST)).toBeNull()
    expect(wildcardSlugFromHost('riff.ainative.app', HOST)).toBeNull()
  })

  it('rejects subdomains with invalid slug characters', () => {
    expect(wildcardSlugFromHost('bad slug.ainative.studio', HOST)).toBeNull()
  })

  it('returns null when no wildcard host is configured', () => {
    expect(wildcardSlugFromHost('riff.ainative.studio', '')).toBeNull()
    expect(wildcardSlugFromHost(null, HOST)).toBeNull()
  })
})

describe('wildcardUrl', () => {
  it('returns null when no wildcard host is configured', () => {
    // WILDCARD_HOST defaults to '' in test env (no AINATIVE_WILDCARD_HOST set).
    expect(wildcardUrl('riff')).toBeNull()
  })
})

// #78 — the subdomain paid+claimed gate. Pure functions the edge middleware consults
// after extracting a slug: a company's {slug}.ainative.studio host may ONLY resolve
// when it is on a PAID plan AND has explicitly claimed the subdomain.
describe('isPaidPlan (#78)', () => {
  it('is true for every paid tier (case-insensitive)', () => {
    for (const p of ['pro', 'business', 'enterprise', 'cody_vcto', 'PRO', 'Business']) {
      expect(isPaidPlan(p)).toBe(true)
    }
  })

  it('is false for unpaid / empty / unknown plans', () => {
    for (const p of ['', 'free', 'hobbyist', 'trial', undefined, null]) {
      expect(isPaidPlan(p as string | null | undefined)).toBe(false)
    }
  })
})

describe('subdomainServable (#78)', () => {
  it('serves ONLY when paid AND claimed', () => {
    expect(subdomainServable({ plan: 'pro', subdomainClaimed: true })).toBe(true)
    expect(subdomainServable({ plan: 'enterprise', subdomainClaimed: true })).toBe(true)
  })

  it('does NOT serve a paid-but-unclaimed company', () => {
    expect(subdomainServable({ plan: 'pro', subdomainClaimed: false })).toBe(false)
    expect(subdomainServable({ plan: 'business' })).toBe(false)
  })

  it('does NOT serve a claimed-but-unpaid company (claim without pay is impossible, but fail closed)', () => {
    expect(subdomainServable({ plan: '', subdomainClaimed: true })).toBe(false)
    expect(subdomainServable({ plan: 'free', subdomainClaimed: true })).toBe(false)
    expect(subdomainServable({ subdomainClaimed: true })).toBe(false)
  })

  it('fail-safe: a null/undefined entry (unregistered or lookup error) is NOT servable', () => {
    expect(subdomainServable(null)).toBe(false)
    expect(subdomainServable(undefined)).toBe(false)
  })

  it('treats a truthy-but-non-true claimed value as NOT claimed (strict === true)', () => {
    // Defensive: only an explicit boolean true claims the subdomain.
    expect(subdomainServable({ plan: 'pro', subdomainClaimed: 1 as unknown as boolean })).toBe(false)
  })
})
