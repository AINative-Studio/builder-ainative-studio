import { describe, it, expect } from 'vitest'
import { GET } from '@/app/.well-known/poppy.json/route'

/**
 * #1842 — /.well-known/poppy.json (Personal Agent Protocol 0.4).
 *
 * The scoring assertions below mirror core's own real AX scanner
 * (`check_poppy()` in core's ax_audit_service.py, core#9837/#9876), which is
 * what produced the 0/3 in the audit this issue came from. Each of its four
 * checks is asserted explicitly so a regression here shows up as a failing
 * test rather than a silently-dropped audit score.
 */
describe('GET /.well-known/poppy.json', () => {
  it('serves a valid JSON object (scanner check 1)', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const doc = await res.json()
    expect(typeof doc).toBe('object')
    expect(doc).not.toBeNull()
    expect(Array.isArray(doc)).toBe(false)
  })

  it('has all four required top-level fields (scanner check 2)', async () => {
    const doc = await (await GET()).json()
    for (const field of ['protocol_version', 'organization', 'auth', 'agent']) {
      expect(doc[field], `missing required field ${field}`).toBeDefined()
    }
  })

  it('auth.issuer is a non-empty string pointing at core real OAuth server (scanner check 3)', async () => {
    const doc = await (await GET()).json()
    expect(typeof doc.auth.issuer).toBe('string')
    expect(doc.auth.issuer.length).toBeGreaterThan(0)
    // Builder is a CLIENT of core's real authorization server, not an issuer.
    expect(doc.auth.issuer).toContain('api.ainative.studio')
  })

  it('agent.protocols has a type:"poppy" entry with a non-empty endpoint (scanner check 4)', async () => {
    const doc = await (await GET()).json()
    expect(Array.isArray(doc.agent.protocols)).toBe(true)
    const poppy = doc.agent.protocols.find((p: { type: string }) => p.type === 'poppy')
    expect(poppy).toBeDefined()
    expect(typeof poppy.endpoint).toBe('string')
    expect(poppy.endpoint.length).toBeGreaterThan(0)
  })

  it('declares protocol version 0.4', async () => {
    const doc = await (await GET()).json()
    expect(doc.protocol_version).toBe('0.4')
  })

  it('organization.domain is the host that serves the document (spec requirement)', async () => {
    const doc = await (await GET()).json()
    expect(doc.organization.domain).toBe('builder.ainative.studio')
    // Must be a bare host, not a URL — a Personal Agent compares it to the host.
    expect(doc.organization.domain).not.toMatch(/^https?:\/\//)
    expect(doc.organization.name).toBe('AINative Builder')
  })

  it('the advertised endpoint is Builder own REAL implemented conversation route', async () => {
    const doc = await (await GET()).json()
    const poppy = doc.agent.protocols.find((p: { type: string }) => p.type === 'poppy')
    // This exact path is implemented by app/poppy/conversations/route.ts.
    expect(poppy.endpoint).toBe('https://builder.ainative.studio/poppy/conversations')
  })

  it('advertises only the builder:ask scope that really works', async () => {
    const doc = await (await GET()).json()
    expect(Object.keys(doc.auth.scopes)).toEqual(['builder:ask'])
    // builder:draft was deliberately NOT advertised — Builder requires a real
    // account to build (#1848), so an agent cannot start one for a human.
    expect(doc.auth.scopes['builder:draft']).toBeUndefined()
    expect(doc.auth.scope_hints['builder:ask']).toEqual({ changes: 'none', personal_data: false })
  })

  it('points at Builder real, already-published OpenAPI document', async () => {
    const doc = await (await GET()).json()
    expect(doc.apis[0].type).toBe('openapi')
    expect(doc.apis[0].url).toBe('https://builder.ainative.studio/openapi.json')
  })

  it('serves JSON with a cache header', async () => {
    const res = await GET()
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('cache-control')).toContain('max-age')
  })
})
