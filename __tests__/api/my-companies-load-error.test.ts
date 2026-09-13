import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Real bug found live (2026-09-13, core#7395): Builder's own ZeroDB registry
 * project started returning 403 on every read, platform-wide. GET
 * /api/build/my-companies used to catch that with `.catch(() => [])` and
 * return { companies: [] } — indistinguishable from a founder who genuinely
 * has no companies. A real founder (arif@8genc.com) reported their projects
 * had "disappeared." This route now reports { companies: [], ok: false }
 * with a 503 on a real registry failure, never masquerading as empty.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<{ user: { email: string } } | null> => ({ user: { email: 'arif@8genc.com' } })),
  listAppsForOwnerWithStatus: vi.fn(async (): Promise<{ apps: any[]; ok: boolean }> => ({ apps: [], ok: true })),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', () => ({
  listAppsForOwnerWithStatus: h.listAppsForOwnerWithStatus,
}))

import { GET } from '@/app/api/build/my-companies/route'

beforeEach(() => {
  h.auth.mockReset().mockResolvedValue({ user: { email: 'arif@8genc.com' } })
  h.listAppsForOwnerWithStatus.mockReset().mockResolvedValue({ apps: [], ok: true })
})
afterEach(() => { vi.restoreAllMocks() })

describe('GET /api/build/my-companies', () => {
  it('returns 401 when not signed in', async () => {
    h.auth.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns companies with ok:true on a real, successful read', async () => {
    h.listAppsForOwnerWithStatus.mockResolvedValue({
      apps: [{ slug: 'ember-box', chatId: 'chat-1', name: 'Ember Box', createdAt: '2026-08-01' }],
      ok: true,
    })
    const res = await GET()
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.companies).toHaveLength(1)
    expect(data.companies[0].slug).toBe('ember-box')
  })

  it('returns a real 503 error, NOT an empty companies list, when the registry read fails (core#7395)', async () => {
    h.listAppsForOwnerWithStatus.mockResolvedValue({ apps: [], ok: false })
    const res = await GET()
    const data = await res.json()
    expect(res.status).toBe(503)
    expect(data.ok).toBe(false)
    expect(data.error).toBe('registry_unavailable')
    expect(data.companies).toEqual([])
  })

  it('returns the 503 error state even if the underlying call throws', async () => {
    h.listAppsForOwnerWithStatus.mockRejectedValue(new Error('network down'))
    const res = await GET()
    const data = await res.json()
    expect(res.status).toBe(503)
    expect(data.ok).toBe(false)
  })

  it('an honest genuine-empty result (ok:true, zero apps) is NOT treated as an error', async () => {
    h.listAppsForOwnerWithStatus.mockResolvedValue({ apps: [], ok: true })
    const res = await GET()
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.companies).toEqual([])
  })
})
