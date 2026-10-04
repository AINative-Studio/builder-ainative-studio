import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * GET /api/admin/template-submissions (#919) — must never authorize via a
 * substring match on the caller's email.
 */

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))

vi.mock('@/lib/db', () => {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => Promise.resolve([]),
  }
  return { db: chain }
})

vi.mock('@/lib/db/schema', () => ({ template_submissions: {}, users: {} }))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/admin/template-submissions/route'

function getReq(url: string) {
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('#919 GET /api/admin/template-submissions', () => {
  it('rejects an email containing "admin" as a substring but not a real admin (THE VULNERABILITY)', async () => {
    h.requireAdmin.mockResolvedValue({ ok: false, status: 403, message: 'Admin access required' })

    const res: any = await GET(getReq('http://localhost/api/admin/template-submissions'))

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/admin/i)
  })

  it('rejects with 401 when there is no session', async () => {
    h.requireAdmin.mockResolvedValue({ ok: false, status: 401, message: 'Authentication required' })

    const res: any = await GET(getReq('http://localhost/api/admin/template-submissions'))

    expect(res.status).toBe(401)
  })

  it('allows a real admin through to the handler', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'founder@realcompany.com', userId: 'user-uuid-1' })

    const res: any = await GET(getReq('http://localhost/api/admin/template-submissions'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.submissions).toEqual([])
  })

  it('honors an explicit status filter for a real admin', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'founder@realcompany.com', userId: 'user-uuid-1' })

    const res: any = await GET(getReq('http://localhost/api/admin/template-submissions?status=approved'))

    expect(res.status).toBe(200)
  })
})
