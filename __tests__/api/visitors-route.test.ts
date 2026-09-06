import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #483/#563 — GET /api/build/visitors?slug=X — the real count behind the Live
 * dashboard's "visitors" hero metric.
 */

const h = vi.hoisted(() => ({
  resolveApp: vi.fn(),
  countVisitors: vi.fn(),
}))

vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/build/visitor-metrics', () => ({ countVisitors: h.countVisitors }))

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
    expect(h.resolveApp).not.toHaveBeenCalled()
  })

  it('returns an honest visitors:0 for an unknown company — never 404s the dashboard', async () => {
    h.resolveApp.mockResolvedValue(null)
    const res: any = await GET(getReq('http://localhost/api/build/visitors?slug=ghost'))
    const json = await res.json()
    expect(json).toEqual({ visitors: 0 })
    expect(h.countVisitors).not.toHaveBeenCalled()
  })

  it('returns the real count from the company\'s own ZeroDB project', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'beacon', zerodbProjectId: 'proj-beacon' })
    h.countVisitors.mockResolvedValue(17)
    const res: any = await GET(getReq('http://localhost/api/build/visitors?slug=beacon'))
    const json = await res.json()
    expect(json).toEqual({ visitors: 17 })
    expect(h.countVisitors).toHaveBeenCalledWith('proj-beacon')
  })

  it('a never-visited, provisioned company honestly reads 0 — never fabricated', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'fresh', zerodbProjectId: 'proj-fresh' })
    h.countVisitors.mockResolvedValue(0)
    const res: any = await GET(getReq('http://localhost/api/build/visitors?slug=fresh'))
    const json = await res.json()
    expect(json).toEqual({ visitors: 0 })
  })
})
