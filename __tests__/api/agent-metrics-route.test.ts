import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/agent/metrics (builder#57, wired via #1213) — a complete,
 * ZeroDB-backed implementation with zero frontend callers before this
 * issue. Confirmed the backing `agent_runs` table is real and actively
 * written: lib/services/agent-runs.service.ts's logAgentRun() is called
 * from app/api/chat-ws/route.ts on every headless agent run.
 *
 * Upgraded the gate from "any authenticated user" to requireAdmin() (#1213)
 * — this exposes cross-founder cost/performance telemetry, which is the
 * same class of gap #919 fixed for /admin/errors, and is a precondition for
 * safely wiring a real UI consumer (/admin/agent-metrics).
 */

const h = vi.hoisted(() => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/build/env-keys', () => ({ getAinativeApiKey: () => 'real-key' }))

function getReq(url: string) {
  return new NextRequest(url)
}

describe('GET /api/agent/metrics', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('rejects a non-admin caller without querying ZeroDB — fails closed', async () => {
    h.requireAdmin.mockResolvedValue({ ok: false, status: 403, message: 'Admin access required' })

    const { GET } = await import('@/app/api/agent/metrics/route')
    const res = await GET(getReq('http://localhost/api/agent/metrics'))

    expect(res.status).toBe(403)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller with 401', async () => {
    h.requireAdmin.mockResolvedValue({ ok: false, status: 401, message: 'Authentication required' })

    const { GET } = await import('@/app/api/agent/metrics/route')
    const res = await GET(getReq('http://localhost/api/agent/metrics'))

    expect(res.status).toBe(401)
  })

  it('computes real aggregate metrics from ZeroDB rows for an admin caller', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'admin@ainative.studio', userId: 'u1' })
    ;(global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [
            { chat_id: 'c1', model: 'claude-sonnet-4', turns: 3, build_passed: true, duration_ms: 1000, fallback: false, total_cost_usd: 0.1, created_at: new Date().toISOString() },
            { chat_id: 'c2', model: 'claude-sonnet-4', turns: 5, build_passed: false, duration_ms: 2000, fallback: true, total_cost_usd: 0.2, created_at: new Date().toISOString() },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) })

    const { GET } = await import('@/app/api/agent/metrics/route')
    const res = await GET(getReq('http://localhost/api/agent/metrics?days=7'))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.totalRuns).toBe(2)
    expect(data.buildPassRate).toBe(0.5)
    expect(data.fallbackRate).toBe(0.5)
    expect(data.days).toBe(7)
  })

  it('returns zeroed metrics (not an error) when the ZeroDB table has no rows yet', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'admin@ainative.studio', userId: 'u1' })
    ;(global.fetch as any).mockResolvedValue({ ok: false, status: 404 })

    const { GET } = await import('@/app/api/agent/metrics/route')
    const res = await GET(getReq('http://localhost/api/agent/metrics'))

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.totalRuns).toBe(0)
  })

  it('caps the days window at 90', async () => {
    h.requireAdmin.mockResolvedValue({ ok: true, email: 'admin@ainative.studio', userId: 'u1' })
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ rows: [] }) })

    const { GET } = await import('@/app/api/agent/metrics/route')
    await GET(getReq('http://localhost/api/agent/metrics?days=9999'))

    const [, opts] = (global.fetch as any).mock.calls[0]
    const body = JSON.parse(opts.body)
    // 90-day lower bound sanity: the since-date should be ~90 days back, not 9999.
    const since = new Date(body.filters.created_at.$gte)
    const daysAgo = (Date.now() - since.getTime()) / (24 * 60 * 60 * 1000)
    expect(daysAgo).toBeLessThan(91)
    expect(daysAgo).toBeGreaterThan(88)
  })
})
