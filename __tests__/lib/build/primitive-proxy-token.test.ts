import { describe, it, expect } from 'vitest'
import { mintPrimitiveProxyToken, verifyPrimitiveProxyToken } from '@/lib/build/primitive-proxy-token'
import { mintAppDataToken } from '@/lib/build/app-data-token'

describe('primitive-proxy-token (#443) — secure per-app primitive binding', () => {
  it('mints a token that verifies back to the same {slug, primitive}', () => {
    const t = mintPrimitiveProxyToken('coffee-shop', 'zerocommerce', 1_700_000_000)
    const p = verifyPrimitiveProxyToken(t)
    expect(p).not.toBeNull()
    expect(p!.slug).toBe('coffee-shop')
    expect(p!.primitive).toBe('zerocommerce')
  })

  it('FAILS CLOSED on a missing/empty token', () => {
    expect(verifyPrimitiveProxyToken(null)).toBeNull()
    expect(verifyPrimitiveProxyToken(undefined)).toBeNull()
    expect(verifyPrimitiveProxyToken('')).toBeNull()
    expect(verifyPrimitiveProxyToken('garbage')).toBeNull()
  })

  it('rejects a FORGED signature (IDOR prevention)', () => {
    const t = mintPrimitiveProxyToken('victim', 'zerocommerce', 1_700_000_000)
    const [payload] = t.split('.')
    expect(verifyPrimitiveProxyToken(`${payload}.deadbeef`)).toBeNull()
  })

  it('requires a slug to mint', () => {
    expect(() => mintPrimitiveProxyToken('', 'zerocommerce', 1)).toThrow()
  })

  it('a /api/db data token cannot be replayed here even though both use AUTH_SECRET (distinct purpose tag)', () => {
    const dbToken = mintAppDataToken('proj-123', 'coffee-shop', 1_700_000_000)
    expect(verifyPrimitiveProxyToken(dbToken)).toBeNull()
  })
})
