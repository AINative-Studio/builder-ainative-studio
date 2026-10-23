import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/design-tokens/versions (US-025, wired via #1213) — a cross-token
 * overview (every token grouped by name with its version list + optional
 * generation-usage stats), distinct from the already-wired per-token
 * GET /api/design-tokens/[tokenId]/versions. Had zero frontend callers.
 *
 * Found and fixed a real bug while confirming this route's auth actually
 * works for a real signed-in founder: it used to verify a raw `verifyJWT`
 * bearer/cookie token, a DIFFERENT auth scheme from every sibling route
 * under /api/design-tokens/* (getAuthenticatedUser(), next-auth
 * session-based). A real browser session only carries the next-auth
 * session cookie, so this route 401'd for every real caller regardless of
 * wiring. Fixed to use the same getAuthenticatedUser() as its siblings.
 */

const h = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }))
vi.mock('@/lib/design-tokens/auth-helper', () => ({ getAuthenticatedUser: h.getAuthenticatedUser }))

const q = vi.hoisted(() => ({
  getDesignTokensByUserId: vi.fn(),
  getDesignTokenVersions: vi.fn(),
  getGenerationsByDesignToken: vi.fn(),
}))
vi.mock('@/lib/db/queries', () => q)

function getReq(url: string) {
  return new NextRequest(url)
}

describe('GET /api/design-tokens/versions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects an unauthenticated caller — session-based, not a raw bearer token', async () => {
    h.getAuthenticatedUser.mockResolvedValue(null)

    const { GET } = await import('@/app/api/design-tokens/versions/route')
    const res = await GET(getReq('http://localhost/api/design-tokens/versions'))

    expect(res.status).toBe(401)
    expect(q.getDesignTokensByUserId).not.toHaveBeenCalled()
  })

  it('groups the real session user\'s tokens by name with version lists', async () => {
    h.getAuthenticatedUser.mockResolvedValue({ userId: 'user-1', email: 'f@x.com' })
    q.getDesignTokensByUserId.mockResolvedValue([
      { id: 't1', name: 'Acme Brand', version: '1.0.0', is_active: true, created_at: new Date(), updated_at: new Date() },
      { id: 't2', name: 'Acme Brand', version: '2.0.0', is_active: false, created_at: new Date(), updated_at: new Date() },
    ])

    const { GET } = await import('@/app/api/design-tokens/versions/route')
    const res = await GET(getReq('http://localhost/api/design-tokens/versions'))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.tokens).toHaveLength(1)
    expect(data.tokens[0].name).toBe('Acme Brand')
    expect(data.tokens[0].totalVersions).toBe(2)
    expect(data.tokens[0].activeVersion).toBe('1.0.0')
  })

  it('includes real generation-usage stats only when includeStats=true', async () => {
    h.getAuthenticatedUser.mockResolvedValue({ userId: 'user-1', email: 'f@x.com' })
    q.getDesignTokensByUserId.mockResolvedValue([
      { id: 't1', name: 'Acme Brand', version: '1.0.0', is_active: true, created_at: new Date(), updated_at: new Date() },
    ])
    q.getGenerationsByDesignToken.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }])

    const { GET } = await import('@/app/api/design-tokens/versions/route')
    const res = await GET(getReq('http://localhost/api/design-tokens/versions?includeStats=true'))

    const data = await res.json()
    expect(data.tokens[0].versions[0].generationCount).toBe(2)
    expect(q.getGenerationsByDesignToken).toHaveBeenCalledWith('t1')
  })

  it('filters by name when provided, using the real session userId', async () => {
    h.getAuthenticatedUser.mockResolvedValue({ userId: 'user-1', email: 'f@x.com' })
    q.getDesignTokenVersions.mockResolvedValue([])

    const { GET } = await import('@/app/api/design-tokens/versions/route')
    await GET(getReq('http://localhost/api/design-tokens/versions?name=Acme'))

    expect(q.getDesignTokenVersions).toHaveBeenCalledWith({ userId: 'user-1', name: 'Acme' })
  })
})
