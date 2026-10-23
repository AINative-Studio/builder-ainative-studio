/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ requireAdmin: vi.fn(), listRecentRunHealth: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/build/loop-enrollment', () => ({ listRecentRunHealth: h.listRecentRunHealth }))

import { GET } from '@/app/api/build/nightly-loop/health/route'
import { NextRequest } from 'next/server'

function req(url = 'https://x.test/api/build/nightly-loop/health') {
  return new NextRequest(url)
}

describe('GET /api/build/nightly-loop/health (#1141)', () => {
  beforeEach(() => {
    h.requireAdmin.mockReset()
    h.listRecentRunHealth.mockReset()
  })

  it('rejects a non-admin request without reading run health', async () => {
    h.requireAdmin.mockResolvedValue({ ok: false, status: 403, message: 'Admin access required' })
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(h.listRecentRunHealth).not.toHaveBeenCalled()
  })

  it('returns recent run health for an admin request', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'a@b.com', userId: '1' })
    const runs = [
      { recordedAt: '2026-10-20T20:00:00.000Z', shardIndex: 0, shardCount: 4, enrolled: 10, processed: 10, deferred: 0, budgetExhausted: false, dispatched: 3, failed: 0, tasksAttempted: 3, tasksCompleted: 3, stalledCompanies: 0, elapsedMs: 1200 },
    ]
    h.listRecentRunHealth.mockResolvedValue(runs)

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.runs).toEqual(runs)
    expect(h.listRecentRunHealth).toHaveBeenCalledWith(20)
  })

  it('clamps an out-of-range limit query param', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'a@b.com', userId: '1' })
    h.listRecentRunHealth.mockResolvedValue([])

    await GET(req('https://x.test/api/build/nightly-loop/health?limit=99999'))
    expect(h.listRecentRunHealth).toHaveBeenCalledWith(200)
  })
})
