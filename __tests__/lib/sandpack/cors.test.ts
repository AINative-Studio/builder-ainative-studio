import { describe, it, expect } from 'vitest'
import { isAllowedSandpackOrigin, sandpackCorsHeaders } from '@/lib/sandpack/cors'

/**
 * #1561 — CORS origin matching for the Sandpack bundler. Sandpack serves
 * each live preview from a PER-SANDBOX subdomain (e.g.
 * https://abc123-sandpack-bundler-production.up.railway.app), not the bare
 * bundler origin, so this must match subdomains of the configured bundler
 * host — but must NOT fall for a naive substring/suffix trick that puts the
 * real host inside an attacker-controlled domain.
 */
describe('isAllowedSandpackOrigin', () => {
  const BUNDLER = 'https://sandpack-bundler-production.up.railway.app'

  it('allows the bare bundler origin itself', () => {
    expect(isAllowedSandpackOrigin('https://sandpack-bundler-production.up.railway.app', BUNDLER)).toBe(true)
  })

  it('allows a real per-sandbox subdomain of the bundler host', () => {
    expect(isAllowedSandpackOrigin('https://abc123.sandpack-bundler-production.up.railway.app', BUNDLER)).toBe(true)
  })

  it('allows a deeply nested subdomain too', () => {
    expect(isAllowedSandpackOrigin('https://a.b.sandpack-bundler-production.up.railway.app', BUNDLER)).toBe(true)
  })

  it('rejects an unrelated origin', () => {
    expect(isAllowedSandpackOrigin('https://evil.example.com', BUNDLER)).toBe(false)
  })

  it('rejects the classic suffix-spoof trick (real host as a path/subdomain prefix of an attacker domain)', () => {
    expect(isAllowedSandpackOrigin('https://sandpack-bundler-production.up.railway.app.evil.com', BUNDLER)).toBe(false)
  })

  it('rejects an origin that merely CONTAINS the bundler host as a substring with no subdomain relationship', () => {
    expect(isAllowedSandpackOrigin('https://evilsandpack-bundler-production.up.railway.app', BUNDLER)).toBe(false)
  })

  it('rejects null/empty origin', () => {
    expect(isAllowedSandpackOrigin(null, BUNDLER)).toBe(false)
    expect(isAllowedSandpackOrigin('', BUNDLER)).toBe(false)
  })

  it('rejects a malformed origin rather than throwing', () => {
    expect(isAllowedSandpackOrigin('not-a-url', BUNDLER)).toBe(false)
  })

  it('rejects everything when the bundler base URL itself is unset/malformed', () => {
    expect(isAllowedSandpackOrigin('https://sandpack-bundler-production.up.railway.app', '')).toBe(false)
  })

  it('also works against the stock CodeSandbox bundler host', () => {
    const CODESANDBOX = 'https://2-19-8-sandpack.codesandbox.io'
    expect(isAllowedSandpackOrigin('https://abc.2-19-8-sandpack.codesandbox.io', CODESANDBOX)).toBe(true)
    expect(isAllowedSandpackOrigin('https://2-19-8-sandpack.codesandbox.io', CODESANDBOX)).toBe(true)
  })
})

describe('sandpackCorsHeaders', () => {
  it('reflects the exact given origin, never a wildcard', () => {
    const headers = sandpackCorsHeaders('https://abc123.sandpack-bundler-production.up.railway.app')
    expect(headers['Access-Control-Allow-Origin']).toBe('https://abc123.sandpack-bundler-production.up.railway.app')
  })

  it('allows the x-ainative-db-token header the shim sends', () => {
    const headers = sandpackCorsHeaders('https://x.example.com')
    expect(headers['Access-Control-Allow-Headers']).toContain('x-ainative-db-token')
  })

  it('includes Vary: Origin so a CDN/cache never serves one origin\'s CORS headers to another', () => {
    const headers = sandpackCorsHeaders('https://x.example.com')
    expect(headers.Vary).toBe('Origin')
  })
})
