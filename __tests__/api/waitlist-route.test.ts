import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #844 — GET /api/build/waitlist?slug=X — the real signups behind the Live
 * dashboard's "waitlist" hero metric and WaitlistPanel.
 */

const h = vi.hoisted(() => ({
  resolveAppVerified: vi.fn(),
  listWaitlist: vi.fn(),
}))

vi.mock('@/lib/build/app-registry', () => ({ resolveAppVerified: h.resolveAppVerified }))
vi.mock('@/lib/build/waitlist-metrics', () => ({ listWaitlist: h.listWaitlist }))

import { GET } from '@/app/api/build/waitlist/route'

function getReq(url: string) {
  return { nextUrl: new URL(url) } as any
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/build/waitlist', () => {
  it('requires a slug', async () => {
    const res: any = await GET(getReq('http://localhost/api/build/waitlist'))
    expect(res.status).toBe(400)
    expect(h.resolveAppVerified).not.toHaveBeenCalled()
  })

  it('returns an honest entries:[] for a CONFIRMED-absent company — never 404s the dashboard', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: true })
    const res: any = await GET(getReq('http://localhost/api/build/waitlist?slug=ghost'))
    const json = await res.json()
    expect(json).toEqual({ entries: [] })
    expect(h.listWaitlist).not.toHaveBeenCalled()
  })

  // Real bug fix (#1316-class): a transient registry-read failure used to be
  // indistinguishable from a confirmed-absent company — both returned
  // entries:[], which the Live dashboard's hero metric and WaitlistPanel then
  // showed as a confident "0 signups" for a company that may have real leads.
  it('fails closed (503) on an UNVERIFIED lookup — never fabricates entries:[]', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })
    const res: any = await GET(getReq('http://localhost/api/build/waitlist?slug=agentive'))
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'lookup_failed' })
    expect(h.listWaitlist).not.toHaveBeenCalled()
  })

  it('returns the real entries from the company\'s own ZeroDB project', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { slug: 'agentive', zerodbProjectId: 'proj-agentive' }, verified: true })
    h.listWaitlist.mockResolvedValue([{ email: 'a@x.com', joinedAt: '2026-09-20T00:00:00.000Z' }])
    const res: any = await GET(getReq('http://localhost/api/build/waitlist?slug=agentive'))
    const json = await res.json()
    expect(json).toEqual({ entries: [{ email: 'a@x.com', joinedAt: '2026-09-20T00:00:00.000Z' }] })
    expect(h.listWaitlist).toHaveBeenCalledWith('proj-agentive')
  })

  it('a never-signed-up, provisioned company honestly reads [] — never fabricated', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { slug: 'fresh', zerodbProjectId: 'proj-fresh' }, verified: true })
    h.listWaitlist.mockResolvedValue([])
    const res: any = await GET(getReq('http://localhost/api/build/waitlist?slug=fresh'))
    const json = await res.json()
    expect(json).toEqual({ entries: [] })
  })
})
