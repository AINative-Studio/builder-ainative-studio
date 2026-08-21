import { describe, it, expect } from 'vitest'
import { wildcardSlugFromHost, wildcardUrl } from '@/lib/build/deploy'

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
