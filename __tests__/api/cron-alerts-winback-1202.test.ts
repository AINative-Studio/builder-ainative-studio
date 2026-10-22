import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1202 (Coverage Phase 3) — GET+POST /api/cron/alerts and GET /api/cron/
 * winback had zero route-level coverage. Both are cron-secret-gated
 * (`Authorization: Bearer $CRON_SECRET`); winback additionally has an
 * unauthenticated unsubscribe path. lib/jobs/alerting and
 * lib/growth/winback-email are mocked at the boundary.
 */

const alerting = vi.hoisted(() => ({ handleAlertCheck: vi.fn() }))
vi.mock('@/lib/jobs/alerting', () => alerting)

const winback = vi.hoisted(() => ({ runWinbackSweep: vi.fn(), unsubscribe: vi.fn() }))
vi.mock('@/lib/growth/winback-email', () => winback)

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { mockGetRequest } from '../helpers/api-route-harness'

const ORIGINAL_SECRET = process.env.CRON_SECRET

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = ORIGINAL_SECRET
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('#1202 GET /api/cron/alerts', () => {
  it('returns 401 when CRON_SECRET is set but the header does not match', async () => {
    process.env.CRON_SECRET = 'real-secret'
    const { GET } = await import('@/app/api/cron/alerts/route')

    const res = await GET(mockGetRequest('http://localhost/api/cron/alerts'))

    expect(res.status).toBe(401)
  })

  it('runs the alert check when the secret matches', async () => {
    process.env.CRON_SECRET = 'real-secret'
    alerting.handleAlertCheck.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    )
    const { GET } = await import('@/app/api/cron/alerts/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/cron/alerts', {
        headers: { authorization: 'Bearer real-secret' },
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('runs with no secret check when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET
    alerting.handleAlertCheck.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    )
    const { GET } = await import('@/app/api/cron/alerts/route')

    const res = await GET(mockGetRequest('http://localhost/api/cron/alerts'))

    expect(res.status).toBe(200)
  })

  it('returns 500 when the check throws', async () => {
    delete process.env.CRON_SECRET
    alerting.handleAlertCheck.mockRejectedValue(new Error('boom'))
    const { GET } = await import('@/app/api/cron/alerts/route')

    const res = await GET(mockGetRequest('http://localhost/api/cron/alerts'))

    expect(res.status).toBe(500)
  })

  it('POST delegates to the same handler as GET', async () => {
    delete process.env.CRON_SECRET
    alerting.handleAlertCheck.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    )
    const { POST } = await import('@/app/api/cron/alerts/route')

    const res = await POST(mockGetRequest('http://localhost/api/cron/alerts', { headers: {} }))

    expect(res.status).toBe(200)
  })
})

describe('#1202 GET /api/cron/winback', () => {
  it('unsubscribes without requiring the cron secret', async () => {
    process.env.CRON_SECRET = 'real-secret'
    winback.unsubscribe.mockResolvedValue(undefined)
    const { GET } = await import('@/app/api/cron/winback/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/cron/winback?unsubscribe=founder@example.com')
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.unsubscribed).toBe('founder@example.com')
    expect(winback.unsubscribe).toHaveBeenCalledWith('founder@example.com')
  })

  it('returns 401 for the sweep path when the secret does not match', async () => {
    process.env.CRON_SECRET = 'real-secret'
    const { GET } = await import('@/app/api/cron/winback/route')

    const res = await GET(mockGetRequest('http://localhost/api/cron/winback'))

    expect(res.status).toBe(401)
  })

  it('defaults to a dry run when send is not explicitly true', async () => {
    process.env.CRON_SECRET = 'real-secret'
    winback.runWinbackSweep.mockResolvedValue({
      dryRun: true,
      candidates: 5,
      sent: 0,
      suppressed: 0,
      failed: 0,
    })
    const { GET } = await import('@/app/api/cron/winback/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/cron/winback', {
        headers: { authorization: 'Bearer real-secret' },
      })
    )

    expect(res.status).toBe(200)
    expect(winback.runWinbackSweep).toHaveBeenCalledWith({ dryRun: true, limit: undefined })
  })

  it('sends for real when send=true and respects a numeric limit', async () => {
    process.env.CRON_SECRET = 'real-secret'
    winback.runWinbackSweep.mockResolvedValue({
      dryRun: false,
      candidates: 5,
      sent: 5,
      suppressed: 0,
      failed: 0,
    })
    const { GET } = await import('@/app/api/cron/winback/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/cron/winback?send=true&limit=5', {
        headers: { authorization: 'Bearer real-secret' },
      })
    )

    expect(res.status).toBe(200)
    expect(winback.runWinbackSweep).toHaveBeenCalledWith({ dryRun: false, limit: 5 })
  })

  it('returns 500 when the sweep throws', async () => {
    process.env.CRON_SECRET = 'real-secret'
    winback.runWinbackSweep.mockRejectedValue(new Error('boom'))
    const { GET } = await import('@/app/api/cron/winback/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/cron/winback', {
        headers: { authorization: 'Bearer real-secret' },
      })
    )

    expect(res.status).toBe(500)
  })
})
