import { describe, it, expect } from 'vitest'
import {
  wildcardSlugFromHost,
  wildcardUrl,
  isPaidPlan,
  subdomainServable,
  isReservedHost,
} from '@/lib/build/deploy'

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
                       'zeropipeline', 'memory', 'agency', 'pillsense', 'boardlens',
                       'insyteful']) {
      expect(wildcardSlugFromHost(`${sub}.ainative.studio`, HOST)).toBeNull()
    }
  })

  it('ignores hosted primitive MCP gateway labels (core#6667)', () => {
    // #612 (2026-09-11): mcp.ainative.studio is confirmed LIVE with its own
    // dedicated DNS/routing (does NOT currently fall through to this
    // wildcard — verified via curl, see lib/build/deploy.ts's
    // RESERVED_SUBDOMAINS comment). These labels stay reserved anyway as
    // defense-in-depth: if that dedicated record were ever removed, they
    // must never resolve as a company slug and get hijacked into
    // /build/{label} instead of reaching the real gateway.
    for (const sub of ['mcp', 'strapi', 'prd-generator', 'gtm',
                       'sequential-thinking', 'design-system', 'opencapstack',
                       'google-ads', 'meta-ads', 'dataforseo']) {
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

// core#7954 — the reserved-subdomain guard middleware relies on. Independent of
// AINATIVE_WILDCARD_HOST: must still catch a reserved host even if that env var is
// ever unset or misconfigured, since it's the last line of defense against this
// app's own *.ainative.studio wildcard domain silently swallowing a sibling app's
// traffic if that sibling's specific-domain claim ever lapses.
describe('isReservedHost (#7954)', () => {
  it('flags every reserved label named in the issue', () => {
    for (const sub of ['mcp', 'docs', 'dev', 'memory', 'sc-builders', 'mif', 'core-staging', 'api']) {
      expect(isReservedHost(`${sub}.ainative.studio`, HOST)).toBe(sub)
    }
  })

  it('is case-insensitive and strips a port', () => {
    expect(isReservedHost('MCP.AINative.Studio', HOST)).toBe('mcp')
    expect(isReservedHost('mcp.ainative.studio:3000', HOST)).toBe('mcp')
  })

  it('returns null for a genuine company slug (not reserved)', () => {
    expect(isReservedHost('riff.ainative.studio', HOST)).toBeNull()
    expect(isReservedHost('acme.ainative.studio', HOST)).toBeNull()
  })

  it('returns null for the bare apex (this app has no domain claim there) or no host', () => {
    expect(isReservedHost('ainative.studio', HOST)).toBeNull()
    expect(isReservedHost(null, HOST)).toBeNull()
  })

  it('flags www — it is a DIFFERENT Railway service (redirect to the apex), not this app', () => {
    // Live-verified (core#7954): builder-ainative-studio's own custom-domain claims
    // are ONLY builder.ainative.studio + *.ainative.studio (`railway domain`) — it
    // does not own www.ainative.studio. `dig`/`curl` confirm www resolves to a
    // different Railway target (7nhqiseu.up.railway.app, a 308 redirect to the
    // apex) than builder's own (lnq6rci9.up.railway.app). So www must be rejected
    // by this guard exactly like any other sibling app's reserved label.
    expect(isReservedHost('www.ainative.studio', HOST)).toBe('www')
  })

  it('returns null for an unrelated different host', () => {
    expect(isReservedHost('mcp.example.com', HOST)).toBeNull()
  })

  it('defaults to the ainative.studio apex even with no explicit apex argument', () => {
    // Regression guard: this must NOT depend on AINATIVE_WILDCARD_HOST being set —
    // it is the defense-in-depth backstop for when that config is missing/wrong.
    expect(isReservedHost('mcp.ainative.studio')).toBe('mcp')
  })

  it('returns null for a multi-label subdomain of a reserved host', () => {
    expect(isReservedHost('foo.mcp.ainative.studio', HOST)).toBeNull()
  })

  it('never flags builder.ainative.studio — that IS this app, not a sibling', () => {
    // Regression guard: `builder` is also in RESERVED_SUBDOMAINS (so it can never
    // be claimed as a company slug), but builder-ainative-studio's own live
    // `railway domain` claims are builder.ainative.studio + *.ainative.studio —
    // this guard must never 404 the service's own real production domain.
    expect(isReservedHost('builder.ainative.studio', HOST)).toBeNull()
  })
})
