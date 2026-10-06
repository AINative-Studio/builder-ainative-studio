/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))

vi.hoisted(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-1'
})

function mockFetch(rows: Array<Record<string, unknown>>) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => rows.map((row_data) => ({ row_data })),
    text: async () => JSON.stringify(rows.map((row_data) => ({ row_data }))),
  }) as unknown as Response))
}

import { GET } from '@/app/api/admin/funnel-summary/route'

describe('GET /api/admin/funnel-summary (#BLD-06.12)', () => {
  beforeEach(() => { h.requireAdmin.mockReset() })

  it('rejects a non-admin request', async () => {
    h.requireAdmin.mockResolvedValue({ ok: false, status: 403, message: 'Admin access required' })
    const res = await GET({} as any)
    expect(res.status).toBe(403)
  })

  it('computes share reaching last step from real recorded events', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'a@b.com', userId: '1' })
    mockFetch([
      { event: 'idea_submitted', companyId: 'c1', track: 'app', step: 'intake', timestamp: '2026-10-01T00:00:00.000Z' },
      { event: 'last_step_reached', companyId: 'c1', track: 'app', step: 'preview', timestamp: '2026-10-01T00:10:00.000Z' },
      { event: 'idea_submitted', companyId: 'c2', track: 'app', step: 'intake', timestamp: '2026-10-01T00:00:00.000Z' },
    ])
    const res = await GET({} as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.sampleSize).toBe(2)
    expect(body.shareReachingLastStep).toBeCloseTo(0.5)
  })
})
