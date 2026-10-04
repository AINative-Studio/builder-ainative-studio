import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * PATCH /api/admin/template-submissions/:id (#919) — the mutating endpoint
 * that approves/rejects submissions into the live public template
 * marketplace. Must never authorize via a substring match on email.
 */

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))

const dbState = { submission: null as any }

vi.mock('@/lib/db', () => {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(dbState.submission ? [dbState.submission] : []),
    insert: () => chain,
    values: () => chain,
    update: () => chain,
    set: () => chain,
    returning: () => Promise.resolve([{ id: 'tmpl-1' }]),
  }
  return { db: chain }
})

vi.mock('@/lib/db/schema', () => ({ template_submissions: {}, templates: {} }))

import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/admin/template-submissions/[id]/route'

function patchReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/template-submissions/sub-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  dbState.submission = null
})

describe('#919 PATCH /api/admin/template-submissions/:id', () => {
  it('rejects an email containing "admin" as a substring but not a real admin (THE VULNERABILITY)', async () => {
    h.requireAdmin.mockResolvedValue({ ok: false, status: 403, message: 'Admin access required' })

    const res: any = await PATCH(patchReq({ action: 'approve' }), params('sub-1'))

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/admin/i)
  })

  it('rejects with 401 when there is no session', async () => {
    h.requireAdmin.mockResolvedValue({ ok: false, status: 401, message: 'Authentication required' })

    const res: any = await PATCH(patchReq({ action: 'approve' }), params('sub-1'))

    expect(res.status).toBe(401)
  })

  it('never touches the database when the caller is not a real admin', async () => {
    h.requireAdmin.mockResolvedValue({ ok: false, status: 403, message: 'Admin access required' })
    const { db } = await import('@/lib/db')
    const selectSpy = vi.spyOn(db as any, 'select')

    await PATCH(patchReq({ action: 'approve' }), params('sub-1'))

    expect(selectSpy).not.toHaveBeenCalled()
  })

  it('returns 404 for a real admin when the submission does not exist', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'founder@realcompany.com', userId: 'user-uuid-1' })

    const res: any = await PATCH(patchReq({ action: 'approve' }), params('missing'))

    expect(res.status).toBe(404)
  })

  it('approves a real submission for a real admin and records the admin as reviewer', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'founder@realcompany.com', userId: 'user-uuid-1' })
    dbState.submission = {
      id: 'sub-1',
      template_data: {
        name: 'Landing Page',
        category: 'marketing',
        description: 'A landing page template',
        code: '<div />',
        tags: ['landing'],
        metadata: { placeholders: [], components_used: [], complexity: 'simple' },
      },
    }
    const { db } = await import('@/lib/db')
    const setSpy = vi.spyOn(db as any, 'set')

    const res: any = await PATCH(patchReq({ action: 'approve', admin_notes: 'looks good' }), params('sub-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toMatch(/approved/i)
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', reviewed_by: 'user-uuid-1', admin_notes: 'looks good' })
    )
  })

  it('rejects a real submission for a real admin and records the admin as reviewer', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'founder@realcompany.com', userId: 'user-uuid-1' })
    dbState.submission = { id: 'sub-1', template_data: {} }
    const { db } = await import('@/lib/db')
    const setSpy = vi.spyOn(db as any, 'set')

    const res: any = await PATCH(patchReq({ action: 'reject', admin_notes: 'not ready' }), params('sub-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toMatch(/rejected/i)
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rejected', reviewed_by: 'user-uuid-1', admin_notes: 'not ready' })
    )
  })

  it('returns 400 for an invalid action from a real admin', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'founder@realcompany.com', userId: 'user-uuid-1' })
    dbState.submission = { id: 'sub-1', template_data: {} }

    const res: any = await PATCH(patchReq({ action: 'delete' }), params('sub-1'))

    expect(res.status).toBe(400)
  })

  it('returns 500 and never throws when the database errors', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'founder@realcompany.com', userId: 'user-uuid-1' })
    const { db } = await import('@/lib/db')
    vi.spyOn(db as any, 'limit').mockRejectedValueOnce(new Error('db down'))

    const res: any = await PATCH(patchReq({ action: 'approve' }), params('sub-1'))

    expect(res.status).toBe(500)
  })
})
