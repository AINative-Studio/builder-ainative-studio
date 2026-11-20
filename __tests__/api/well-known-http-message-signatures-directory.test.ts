import { describe, it, expect } from 'vitest'
import { GET } from '@/app/.well-known/http-message-signatures-directory/route'

/**
 * #2175 — /.well-known/http-message-signatures-directory (RFC 9421 key
 * discovery). The AX audit's own worked example target: "found with 1 valid
 * JWK(s) in 'keys'".
 */
describe('GET /.well-known/http-message-signatures-directory', () => {
  it('serves a valid JSON object with a non-empty keys array', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const doc = await res.json()
    expect(Array.isArray(doc.keys)).toBe(true)
    expect(doc.keys.length).toBeGreaterThanOrEqual(1)
  })

  it('the key is a real, syntactically valid JWK (kty/crv/x present, no private material)', async () => {
    const doc = await (await GET()).json()
    const key = doc.keys[0]
    expect(key.kty).toBe('OKP')
    expect(key.crv).toBe('Ed25519')
    expect(typeof key.x).toBe('string')
    expect(key.x.length).toBeGreaterThan(0)
    // The private half (`d`) must NEVER be present in a published directory.
    expect(key.d).toBeUndefined()
  })

  it('declares a stable kid and the expected sig/alg usage fields', async () => {
    const doc = await (await GET()).json()
    const key = doc.keys[0]
    expect(typeof key.kid).toBe('string')
    expect(key.kid.length).toBeGreaterThan(0)
    expect(key.use).toBe('sig')
    expect(key.alg).toBe('EdDSA')
  })

  it('kid is stable across multiple requests within the same process (not regenerated per-request)', async () => {
    const first = await (await GET()).json()
    const second = await (await GET()).json()
    expect(first.keys[0].kid).toBe(second.keys[0].kid)
    expect(first.keys[0].x).toBe(second.keys[0].x)
  })

  it('is honest that this key does not back a live signing flow today', async () => {
    const doc = await (await GET()).json()
    expect(typeof doc.note).toBe('string')
    expect(doc.note.toLowerCase()).toContain('does not currently back')
  })

  it('serves JSON with a cache header', async () => {
    const res = await GET()
    expect(res.headers.get('cache-control')).toContain('max-age')
  })
})
