import { describe, it, expect } from 'vitest'
import { mintAppDataToken, verifyAppDataToken } from '@/lib/build/app-data-token'

describe('app-data-token (#331) — secure per-app scoping', () => {
  it('mints a token that verifies back to the same project', () => {
    const t = mintAppDataToken('proj-123', 'coffee-shop', 1_700_000_000)
    const p = verifyAppDataToken(t)
    expect(p).not.toBeNull()
    expect(p!.projectId).toBe('proj-123')
    expect(p!.slug).toBe('coffee-shop')
  })

  it('FAILS CLOSED on a missing/empty token', () => {
    expect(verifyAppDataToken(null)).toBeNull()
    expect(verifyAppDataToken(undefined)).toBeNull()
    expect(verifyAppDataToken('')).toBeNull()
    expect(verifyAppDataToken('garbage')).toBeNull()
  })

  it('rejects a FORGED signature (IDOR prevention)', () => {
    const t = mintAppDataToken('proj-victim', 'victim', 1_700_000_000)
    const [payload] = t.split('.')
    // attacker keeps the payload but forges a signature
    expect(verifyAppDataToken(`${payload}.deadbeef`)).toBeNull()
    // attacker tries to swap in a different projectId in the payload (breaks sig)
    const evil = Buffer.from(JSON.stringify({ projectId: 'proj-victim2', slug: 'x', iat: 1 }))
      .toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
    expect(verifyAppDataToken(`${evil}.${t.split('.')[1]}`)).toBeNull()
  })

  it('a token for app A cannot be used to claim app B\'s project', () => {
    const tokenA = mintAppDataToken('proj-A', 'app-a', 1_700_000_000)
    const p = verifyAppDataToken(tokenA)
    // it ALWAYS resolves to proj-A — the holder cannot make it resolve to proj-B
    expect(p!.projectId).toBe('proj-A')
    expect(p!.projectId).not.toBe('proj-B')
  })

  it('requires a projectId to mint', () => {
    expect(() => mintAppDataToken('', 'x', 1)).toThrow()
  })
})
