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

  // #814 — contentworkflow is not a FounderScopedPrimitive (it uses
  // Builder's own service key, never a per-founder credential), but it goes
  // through this exact same signed {slug, primitive} binding in the preview
  // iframe — the proxy route requires one for every primitive regardless of
  // its downstream credential model. Confirms the token machinery itself
  // works identically for it (mint, verify, forged-signature rejection).
  it('mints and verifies a contentworkflow token identically to a founder-scoped one (#814)', () => {
    const t = mintPrimitiveProxyToken('agentive-product', 'contentworkflow', 1_700_000_000)
    const p = verifyPrimitiveProxyToken(t)
    expect(p).not.toBeNull()
    expect(p!.slug).toBe('agentive-product')
    expect(p!.primitive).toBe('contentworkflow')
  })

  it('rejects a FORGED contentworkflow token signature (same IDOR protection as any other primitive)', () => {
    const t = mintPrimitiveProxyToken('victim', 'contentworkflow', 1_700_000_000)
    const [payload] = t.split('.')
    expect(verifyPrimitiveProxyToken(`${payload}.deadbeef`)).toBeNull()
  })
})
