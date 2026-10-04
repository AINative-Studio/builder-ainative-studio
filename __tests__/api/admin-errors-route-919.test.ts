import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * GET /api/admin/errors (#919) — must never authorize via a substring match
 * on the caller's email. See __tests__/lib/require-admin-919.test.ts for the
 * exhaustive behavior of the shared `requireAdmin()` gate this route now
 * calls; these tests confirm the route itself is wired to it and responds
 * with the right HTTP status.
 */

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))

vi.mock('@/lib/db/connection', () => {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    groupBy: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve([]),
    then: (resolve: any) => resolve([]),
  }
  return { default: chain }
})

vi.mock('@/lib/db/schema', () => ({ error_logs: {} }))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/admin/errors/route'

function getReq(url: string) {
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('#919 GET /api/admin/errors', () => {
  it('rejects an email containing "admin" as a substring but not a real admin (THE VULNERABILITY)', async () => {
    h.requireAdmin.mockResolvedValue({ ok: false, status: 403, message: 'Admin access required' })

    const res: any = await GET(getReq('http://localhost/api/admin/errors'))

    expect(res.status).toBe(403)
    expect(h.requireAdmin).toHaveBeenCalled()
  })

  it('rejects with 401 when there is no session', async () => {
    h.requireAdmin.mockResolvedValue({ ok: false, status: 401, message: 'Authentication required' })

    const res: any = await GET(getReq('http://localhost/api/admin/errors'))

    expect(res.status).toBe(401)
  })

  it('allows a real admin through to the handler', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'founder@realcompany.com', userId: 'user-uuid-1' })

    const res: any = await GET(getReq('http://localhost/api/admin/errors'))

    expect(res.status).toBe(200)
  })

  it('allows a real admin through with explicit timeRange/errorType/endpoint filters', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'founder@realcompany.com', userId: 'user-uuid-1' })

    const res: any = await GET(
      getReq(
        'http://localhost/api/admin/errors?timeRange=7d&errorType=TypeError&endpoint=/api/build&limit=10'
      )
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.filters.timeRange).toBe('7d')
    expect(body.filters.errorType).toBe('TypeError')
  })

  it('falls back to the default 24h range for an unrecognized timeRange value', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'founder@realcompany.com', userId: 'user-uuid-1' })

    const res: any = await GET(getReq('http://localhost/api/admin/errors?timeRange=bogus'))

    expect(res.status).toBe(200)
  })
})
