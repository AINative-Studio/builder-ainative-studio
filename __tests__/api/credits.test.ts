import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #312 — /api/credits reads the authoritative per-user credit LEDGER
 * (/v1/public/credits/balance + /v1/public/credits/usage/current), NOT the Sila USD
 * wallet. These tests cover the mapping logic:
 *   - normalized ledger shape from the two ledger fetches,
 *   - guest / no-token fallback to a default plan,
 *   - upstream failure → null ledger fields.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getUserPlan: vi.fn(),
  getDefaultPlan: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/services/plan.service', () => ({
  getUserPlan: h.getUserPlan,
  getDefaultPlan: h.getDefaultPlan,
}))

import { GET, normalizeCredits } from '@/app/api/credits/route'

const REAL = { user: { email: 'ada@x.com', type: 'ainative' }, accessToken: 'tok-123' }
const GUEST = { user: { type: 'guest' } } // no accessToken

function okJson(body: unknown) {
  return { ok: true, json: async () => body } as any
}
function fail(status = 500) {
  return { ok: false, status, json: async () => ({}) } as any
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  h.auth.mockReset()
  h.getUserPlan.mockReset().mockResolvedValue({ tier: 'pro' })
  h.getDefaultPlan.mockReset().mockReturnValue({ tier: 'hobbyist' })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('normalizeCredits (#312 ledger mapping)', () => {
  it('maps granted/used/remaining and reset date from the ledger body', () => {
    const c = normalizeCredits({ granted: 10000, used: 3400, remaining: 6600, resets_at: '2026-09-01T00:00:00Z' })
    expect(c.granted).toBe(10000)
    expect(c.used).toBe(3400)
    expect(c.remaining).toBe(6600)
    expect(c.balance).toBe(6600) // balance is an alias for remaining (credits, not USD)
    expect(c.resetsAt).toBe('2026-09-01T00:00:00Z')
  })

  it('derives remaining from granted - used when not provided', () => {
    const c = normalizeCredits({ granted: 500, used: 120 })
    expect(c.remaining).toBe(380)
    expect(c.balance).toBe(380)
  })

  it('unwraps a { data: {...} } envelope', () => {
    const c = normalizeCredits({ data: { credits_remaining: 42, total_credits: 100 } })
    expect(c.remaining).toBe(42)
    expect(c.granted).toBe(100)
  })

  it('returns all-null for an absent body', () => {
    const c = normalizeCredits(null)
    expect(c).toEqual({ granted: null, used: null, remaining: null, balance: null, resetsAt: null })
  })
})

describe('GET /api/credits', () => {
  it('401 when unauthenticated', async () => {
    h.auth.mockResolvedValue(null)
    const res = await GET({} as any)
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('guest / no-token → default plan and null ledger, no upstream calls', async () => {
    h.auth.mockResolvedValue(GUEST)
    const res = await GET({} as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(h.getDefaultPlan).toHaveBeenCalledWith('guest')
    expect(body.plan).toEqual({ tier: 'hobbyist' })
    expect(body.credits.remaining).toBeNull()
    expect(body.userType).toBe('guest')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the ledger endpoints with the session bearer token', async () => {
    h.auth.mockResolvedValue(REAL)
    fetchMock
      .mockResolvedValueOnce(okJson({ granted: 10000, used: 3400, remaining: 6600, resets_at: '2026-09-01' }))
      .mockResolvedValueOnce(okJson({ tokens_used: 1200, tokens_limit: 5000 }))

    const res = await GET({} as any)
    const body = await res.json()

    // Hits the authoritative ledger, NOT /payments/wallets.
    const urls = fetchMock.mock.calls.map((c) => c[0])
    expect(urls[0]).toContain('/v1/public/credits/balance')
    expect(urls[1]).toContain('/v1/public/credits/usage/current')
    expect(urls.some((u: string) => u.includes('/payments/wallets'))).toBe(false)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok-123')

    expect(body.credits.remaining).toBe(6600)
    expect(body.credits.granted).toBe(10000)
    expect(body.credits.used).toBe(3400)
    expect(body.usage).toEqual({ tokens_used: 1200, tokens_limit: 5000 })
    expect(body.plan).toEqual({ tier: 'pro' })
  })

  it('upstream failure → null ledger fields (no throw)', async () => {
    h.auth.mockResolvedValue(REAL)
    fetchMock.mockResolvedValueOnce(fail(500)).mockResolvedValueOnce(fail(503))

    const res = await GET({} as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.credits.remaining).toBeNull()
    expect(body.credits.granted).toBeNull()
    expect(body.usage).toBeNull()
  })

  it('rejected fetch promise is tolerated via allSettled', async () => {
    h.auth.mockResolvedValue(REAL)
    fetchMock.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(okJson({ tokens_used: 5 }))

    const res = await GET({} as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.credits.remaining).toBeNull()
    expect(body.usage).toEqual({ tokens_used: 5 })
  })
})
