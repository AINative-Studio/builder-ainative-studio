import { describe, it, expect } from 'vitest'
import { GET } from '@/app/.well-known/oauth-authorization-server/route'

describe('GET /.well-known/oauth-authorization-server (AX/agent-readiness scan, 2026-09-30)', () => {
  it("points at core's real, already-functioning OAuth2.1/PKCE endpoints, not a fabricated server", async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const doc = await res.json()
    expect(doc.authorization_endpoint).toBe('https://api.ainative.studio/oauth/authorize')
    expect(doc.token_endpoint).toBe('https://api.ainative.studio/v1/oauth/token')
  })

  it('declares S256 PKCE, matching the real enforced method in lib/auth/ainative-oauth.ts', async () => {
    const res = await GET()
    const doc = await res.json()
    expect(doc.code_challenge_methods_supported).toContain('S256')
  })

  it('declares the real supported scopes', async () => {
    const res = await GET()
    const doc = await res.json()
    expect(doc.scopes_supported).toEqual(expect.arrayContaining(['openid', 'profile', 'email']))
  })
})
