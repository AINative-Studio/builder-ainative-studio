import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #483/#563 — GET /api/build/visitors?slug=X — the real count behind the Live
 * dashboard's "visitors" hero metric, plus the entries behind VisitorsPanel.
 */

const h = vi.hoisted(() => ({
  resolveAppVerified: vi.fn(),
  listVisitors: vi.fn(),
}))

vi.mock('@/lib/build/app-registry', () => ({ resolveAppVerified: h.resolveAppVerified }))
vi.mock('@/lib/build/visitor-metrics', () => ({ listVisitors: h.listVisitors }))

import { GET } from '@/app/api/build/visitors/route'

function getReq(url: string) {
  return { nextUrl: new URL(url) } as any
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/build/visitors', () => {
  it('requires a slug', async () => {
    const res: any = await GET(getReq('http://localhost/api/build/visitors'))
    expect(res.status).toBe(400)
    expect(h.resolveAppVerified).not.toHaveBeenCalled()
  })

  it('returns an honest visitors:0, entries:[] for a CONFIRMED-absent company — never 404s the dashboard', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: true })
    const res: any = await GET(getReq('http://localhost/api/build/visitors?slug=ghost'))
    const json = await res.json()
    expect(json).toEqual({ visitors: 0, entries: [] })
    expect(h.listVisitors).not.toHaveBeenCalled()
  })

  // Real bug fix (#1316-class): a transient registry-read failure used to be
  // indistinguishable from a confirmed-absent company — both returned
  // visitors:0/entries:[], which the Live dashboard's hero metric and
  // VisitorsPanel then showed as a confident "0 visitors" for a company that
  // may have real pageviews.
  it('fails closed (503) on an UNVERIFIED lookup — never fabricates visitors:0', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })
    const res: any = await GET(getReq('http://localhost/api/build/visitors?slug=beacon'))
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'lookup_failed' })
    expect(h.listVisitors).not.toHaveBeenCalled()
  })

  it('returns the real count and entries from the company\'s own ZeroDB project, passing both projectId and chatId through', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { slug: 'beacon', zerodbProjectId: 'proj-beacon', chatId: 'chat-beacon' }, verified: true })
    const entries = [
      { path: '/api/preview/chat-beacon', visitedAt: '2026-10-19T00:00:00.000Z' },
      { path: '/api/preview/chat-beacon', visitedAt: '2026-10-18T00:00:00.000Z' },
    ]
    h.listVisitors.mockResolvedValue(entries)
    const res: any = await GET(getReq('http://localhost/api/build/visitors?slug=beacon'))
    const json = await res.json()
    expect(json).toEqual({ visitors: 2, entries })
    expect(h.listVisitors).toHaveBeenCalledWith('proj-beacon', 'chat-beacon')
  })

  it('a never-visited, provisioned company honestly reads 0/[] — never fabricated', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { slug: 'fresh', zerodbProjectId: 'proj-fresh', chatId: 'chat-fresh' }, verified: true })
    h.listVisitors.mockResolvedValue([])
    const res: any = await GET(getReq('http://localhost/api/build/visitors?slug=fresh'))
    const json = await res.json()
    expect(json).toEqual({ visitors: 0, entries: [] })
  })

  // Real bug fix: an UNPROVISIONED company (no zerodbProjectId — confirmed
  // live to be every company sampled in production) still passes its real
  // chatId through, so listVisitors can scope the shared-project fallback
  // correctly instead of reading nothing.
  it('an unprovisioned company (no zerodbProjectId) still passes chatId through for shared-project scoping', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { slug: 'pulsar', chatId: 'chat-pulsar' }, verified: true })
    const entries = [{ path: '/api/preview/chat-pulsar', visitedAt: '2026-10-19T00:00:00.000Z' }]
    h.listVisitors.mockResolvedValue(entries)
    const res: any = await GET(getReq('http://localhost/api/build/visitors?slug=pulsar'))
    const json = await res.json()
    expect(json).toEqual({ visitors: 1, entries })
    expect(h.listVisitors).toHaveBeenCalledWith(undefined, 'chat-pulsar')
  })
})
