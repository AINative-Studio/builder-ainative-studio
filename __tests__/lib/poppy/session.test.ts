import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { verifyPoppySession, checkProtocolVersion, acceptedAudiences } from '@/lib/poppy/session'
import { makeKeyring, TEST_CLIENT_ID, type PoppyKeyring } from '../../helpers/poppy-session'

/**
 * #1842 — Poppy-Session JWT verification (Personal Agent Protocol 0.4, §5).
 *
 * These tests mint REAL ES256 delegation chains (see the helper) and assert
 * the real verification path accepts a valid one and rejects every tampered
 * variant. No network: the JWKS resolver is injected.
 */

const URL_START = 'https://builder.ainative.studio/poppy/conversations'

describe('verifyPoppySession (#1842)', () => {
  let kr: PoppyKeyring

  beforeEach(async () => {
    kr = await makeKeyring()
  })

  it('accepts a real, valid delegation chain and returns the verified identity', async () => {
    const token = await kr.mint({ method: 'POST', url: URL_START, sub: 'user_abc', sid: 'sess_xyz' })
    const result = await verifyPoppySession(token, { method: 'POST', url: URL_START }, kr.resolver)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.session.clientId).toBe(TEST_CLIENT_ID)
    expect(result.session.userId).toBe('user_abc')
    expect(result.session.sessionId).toBe('sess_xyz')
  })

  it('rejects a missing header', async () => {
    const result = await verifyPoppySession(null, { method: 'POST', url: URL_START }, kr.resolver)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('invalid_session')
  })

  it('rejects a token that is not a JWT at all, without throwing', async () => {
    for (const junk of ['', 'not-a-jwt', 'a.b', '....', '{}']) {
      const result = await verifyPoppySession(junk, { method: 'POST', url: URL_START }, kr.resolver)
      expect(result.ok).toBe(false)
    }
  })

  it('rejects a session signed by a key the delegation does NOT confirm', async () => {
    const token = await kr.mint({ method: 'POST', url: URL_START, useWrongSessionKey: true })
    const result = await verifyPoppySession(token, { method: 'POST', url: URL_START }, kr.resolver)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/signature|audience/i)
  })

  it('rejects a wrong typ header (JWT type confusion)', async () => {
    const token = await kr.mint({ method: 'POST', url: URL_START, typ: 'JWT' })
    const result = await verifyPoppySession(token, { method: 'POST', url: URL_START }, kr.resolver)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/typ/)
  })

  it('rejects a session with no poppy_dlg delegation', async () => {
    const token = await kr.mint({ method: 'POST', url: URL_START, omitDelegation: true })
    const result = await verifyPoppySession(token, { method: 'POST', url: URL_START }, kr.resolver)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/poppy_dlg/)
  })

  it('rejects a delegation whose lifetime exceeds the spec 24h maximum', async () => {
    const token = await kr.mint({
      method: 'POST',
      url: URL_START,
      delegationLifetime: 25 * 60 * 60,
    })
    const result = await verifyPoppySession(token, { method: 'POST', url: URL_START }, kr.resolver)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/24h|lifetime/i)
  })

  it('rejects an unknown client_id — no keys resolvable means no trust', async () => {
    const token = await kr.mint({
      method: 'POST',
      url: URL_START,
      clientId: 'https://attacker.example/client',
    })
    const result = await verifyPoppySession(token, { method: 'POST', url: URL_START }, kr.resolver)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/could not resolve signing keys/)
  })

  it('rejects a non-https client_id', async () => {
    const token = await kr.mint({ method: 'POST', url: URL_START, clientId: 'http://agent.test/x' })
    const result = await verifyPoppySession(token, { method: 'POST', url: URL_START }, kr.resolver)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/https/)
  })

  it('rejects a wrong audience — a token minted for another Company cannot be replayed here', async () => {
    const token = await kr.mint({
      method: 'POST',
      url: URL_START,
      audience: 'https://some-other-company.example',
    })
    const result = await verifyPoppySession(token, { method: 'POST', url: URL_START }, kr.resolver)
    expect(result.ok).toBe(false)
  })

  // --- sender constraint: htm / htu bind the token to one method + URL ---

  it('rejects a token whose htm does not match the request method', async () => {
    const token = await kr.mint({ method: 'POST', url: URL_START })
    const result = await verifyPoppySession(token, { method: 'GET', url: URL_START }, kr.resolver)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/htm/)
  })

  it('rejects a token captured for one URL and replayed at another', async () => {
    const token = await kr.mint({ method: 'POST', url: URL_START })
    const result = await verifyPoppySession(
      token,
      { method: 'POST', url: 'https://builder.ainative.studio/poppy/conversations/cnv_1/close' },
      kr.resolver,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/htu/)
  })

  it('ignores query string when matching htu (spec: htu has no query or fragment)', async () => {
    const url = 'https://builder.ainative.studio/poppy/conversations/cnv_1/events'
    const token = await kr.mint({ method: 'GET', url })
    const result = await verifyPoppySession(
      token,
      { method: 'GET', url: `${url}?cursor=evt_1&wait=5` },
      kr.resolver,
    )
    expect(result.ok).toBe(true)
  })

  // --- freshness ---

  it('rejects a stale token as session_ended', async () => {
    const token = await kr.mint({ method: 'POST', url: URL_START, iatOffset: -600 })
    const result = await verifyPoppySession(token, { method: 'POST', url: URL_START }, kr.resolver)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('session_ended')
  })

  it('rejects a token issued in the future beyond clock skew', async () => {
    const token = await kr.mint({ method: 'POST', url: URL_START, iatOffset: 600 })
    const result = await verifyPoppySession(token, { method: 'POST', url: URL_START }, kr.resolver)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/future/)
  })
})

describe('defaultJwksResolver trust anchor (#1842)', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  async function resolve(clientId: string, metadata: unknown, jwks?: unknown) {
    global.fetch = vi.fn(async (url: string | URL) => {
      const u = String(url)
      if (u === clientId) return { ok: true, json: async () => metadata } as unknown as Response
      return { ok: true, json: async () => jwks ?? { keys: [{ kty: 'EC', kid: 'k1' }] } } as unknown as Response
    }) as never
    const { defaultJwksResolver } = await import('@/lib/poppy/session')
    return defaultJwksResolver(clientId)
  }

  it('resolves keys when jwks_uri is on the SAME host as client_id', async () => {
    const clientId = 'https://agent.example/client'
    const keys = await resolve(clientId, {
      client_id: clientId,
      jwks_uri: 'https://agent.example/jwks.json',
    })
    expect(keys).toHaveLength(1)
  })

  it('REFUSES a jwks_uri on a different host — the entire trust anchor', async () => {
    const clientId = 'https://agent.example/client'
    const keys = await resolve(clientId, {
      client_id: clientId,
      jwks_uri: 'https://attacker.example/jwks.json',
    })
    expect(keys).toBeNull()
  })

  it('refuses metadata whose own client_id does not match the fetched URL', async () => {
    const clientId = 'https://agent.example/client'
    const keys = await resolve(clientId, {
      client_id: 'https://agent.example/different',
      jwks_uri: 'https://agent.example/jwks.json',
    })
    expect(keys).toBeNull()
  })

  it('refuses a non-https jwks_uri', async () => {
    const clientId = 'https://agent.example/client'
    const keys = await resolve(clientId, {
      client_id: clientId,
      jwks_uri: 'http://agent.example/jwks.json',
    })
    expect(keys).toBeNull()
  })

  it('returns null (never throws) when discovery fails', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as never
    const { defaultJwksResolver } = await import('@/lib/poppy/session')
    expect(await defaultJwksResolver('https://agent.example/client')).toBeNull()
  })
})

describe('checkProtocolVersion (#1842)', () => {
  it('accepts the supported version', () => {
    expect(checkProtocolVersion('0.4').ok).toBe(true)
  })
  it('tolerates a missing header', () => {
    expect(checkProtocolVersion(null).ok).toBe(true)
  })
  it('rejects a different version', () => {
    expect(checkProtocolVersion('0.3').ok).toBe(false)
  })
})

describe('acceptedAudiences (#1842)', () => {
  it('accepts both the Builder domain and core issuer form', () => {
    const auds = acceptedAudiences()
    expect(auds).toContain('https://builder.ainative.studio')
    expect(auds.some((a) => a.includes('api.ainative.studio'))).toBe(true)
  })
})
