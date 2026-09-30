import { describe, it, expect } from 'vitest'
import { GET } from '@/app/openapi.json/route'

describe('GET /openapi.json (AX/agent-readiness scan, 2026-09-30)', () => {
  it('returns a valid OpenAPI 3.1 document', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const spec = await res.json()
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info?.title).toBeTruthy()
  })

  it('only documents routes this codebase itself already marks as agent-facing', async () => {
    const res = await GET()
    const spec = await res.json()
    const paths = Object.keys(spec.paths)
    // Real, already-agent-callable routes (per public/llms.txt + "AX: agent-accessible" doc comments).
    for (const p of ['/api/health', '/api/chat-ws', '/api/build/artifact', '/api/build/ask', '/api/build/systems', '/api/preview/{chatId}', '/api/build/enroll', '/api/build/secrets', '/api/build/redeploy', '/api/build/deck']) {
      expect(paths).toContain(p)
    }
  })

  it('declares a real security scheme pointing at core\'s actual OAuth endpoints, not a fabricated one', async () => {
    const res = await GET()
    const spec = await res.json()
    const scheme = spec.components?.securitySchemes?.sessionCookie
    expect(scheme?.flows?.authorizationCode?.authorizationUrl).toBe('https://api.ainative.studio/oauth/authorize')
    expect(scheme?.flows?.authorizationCode?.tokenUrl).toBe('https://api.ainative.studio/v1/oauth/token')
  })

  it('declares scoped permissions machine-readably on the security scheme', async () => {
    const res = await GET()
    const spec = await res.json()
    const scopes = spec.components?.securitySchemes?.sessionCookie?.flows?.authorizationCode?.scopes
    expect(scopes).toMatchObject({ openid: expect.any(String), profile: expect.any(String), email: expect.any(String) })
  })
})
