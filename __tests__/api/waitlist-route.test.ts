import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #844 — GET /api/build/waitlist?slug=X — the real signups behind the Live
 * dashboard's "waitlist" hero metric and WaitlistPanel.
 */

const h = vi.hoisted(() => ({
  resolveApp: vi.fn(),
  listWaitlist: vi.fn(),
}))

vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
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
    expect(h.resolveApp).not.toHaveBeenCalled()
  })

  it('returns an honest entries:[] for an unknown company — never 404s the dashboard', async () => {
    h.resolveApp.mockResolvedValue(null)
    const res: any = await GET(getReq('http://localhost/api/build/waitlist?slug=ghost'))
    const json = await res.json()
    expect(json).toEqual({ entries: [] })
    expect(h.listWaitlist).not.toHaveBeenCalled()
  })

  it('returns the real entries from the company\'s own ZeroDB project', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'agentive', zerodbProjectId: 'proj-agentive' })
    h.listWaitlist.mockResolvedValue([{ email: 'a@x.com', joinedAt: '2026-09-20T00:00:00.000Z' }])
    const res: any = await GET(getReq('http://localhost/api/build/waitlist?slug=agentive'))
    const json = await res.json()
    expect(json).toEqual({ entries: [{ email: 'a@x.com', joinedAt: '2026-09-20T00:00:00.000Z' }] })
    expect(h.listWaitlist).toHaveBeenCalledWith('proj-agentive')
  })

  it('a never-signed-up, provisioned company honestly reads [] — never fabricated', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'fresh', zerodbProjectId: 'proj-fresh' })
    h.listWaitlist.mockResolvedValue([])
    const res: any = await GET(getReq('http://localhost/api/build/waitlist?slug=fresh'))
    const json = await res.json()
    expect(json).toEqual({ entries: [] })
  })
})
