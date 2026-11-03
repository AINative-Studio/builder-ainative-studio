import { describe, it, expect } from 'vitest'
import { GET } from '@/app/.well-known/api-catalog/route'

describe('GET /.well-known/api-catalog (RFC 9727, AX/agent-readiness scan 2026-10-29)', () => {
  it('returns a linkset document with the real OpenAPI doc as service-desc', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/linkset+json')
    const body = await res.json()
    expect(Array.isArray(body.linkset)).toBe(true)
    const entry = body.linkset[0]
    expect(entry['service-desc'][0].href).toBe('https://builder.ainative.studio/openapi.json')
  })

  it('points at the real, already-existing OAuth metadata document, not a fabricated one', async () => {
    const res = await GET()
    const body = await res.json()
    const entry = body.linkset[0]
    expect(entry['service-doc'][0].href).toBe(
      'https://builder.ainative.studio/.well-known/oauth-authorization-server',
    )
  })

  it('sets a real cache header', async () => {
    const res = await GET()
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600')
  })
})
