import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #743 — POST /api/build/comms-mode (founder-facing dashboard setting for
 * Cody's email cadence).
 *
 * Properties under test:
 *  - requires a real signed-in founder — 401 for anonymous/guest (same gate
 *    as media/upload/route.ts), never the softer {ok:false,reason:'signin'}
 *    200 zerovoice-style shape (this issue's spec explicitly calls for 401);
 *  - requires a slug (400 on missing);
 *  - validates mode is one of the two allowed values (400 otherwise);
 *  - 404s when the company isn't registered;
 *  - a valid request persists via setAppCommsMode and returns { ok, mode };
 *  - a persistence failure is surfaced honestly, never fabricates success.
 * All collaborators are mocked; no real network call is made.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveApp: vi.fn(),
  setAppCommsMode: vi.fn(async () => true),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: h.resolveApp,
  setAppCommsMode: h.setAppCommsMode,
}))

import { POST } from '@/app/api/build/comms-mode/route'

function postReq(body: unknown) {
  return { json: async () => body } as any
}

const REGISTERED = { slug: 'acme', chatId: 'c1', createdAt: '2026-08-01T00:00:00Z' }

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { email: 'founder@x.com', type: 'regular' } })
  h.resolveApp.mockResolvedValue(REGISTERED)
  h.setAppCommsMode.mockResolvedValue(true)
})

describe('POST /api/build/comms-mode (#743)', () => {
  it('401s for an anonymous session', async () => {
    h.auth.mockResolvedValue(null)
    const res: any = await POST(postReq({ slug: 'acme', mode: 'agile' }))
    expect(res.status).toBe(401)
    expect(h.setAppCommsMode).not.toHaveBeenCalled()
  })

  it('401s for a guest session', async () => {
    h.auth.mockResolvedValue({ user: { email: 'guest-abc@example.com', type: 'guest' } })
    const res: any = await POST(postReq({ slug: 'acme', mode: 'agile' }))
    expect(res.status).toBe(401)
    expect(h.setAppCommsMode).not.toHaveBeenCalled()
  })

  it('400s when slug is missing', async () => {
    const res: any = await POST(postReq({ mode: 'agile' }))
    expect(res.status).toBe(400)
    expect(h.setAppCommsMode).not.toHaveBeenCalled()
  })

  it('400s on an invalid mode value', async () => {
    const res: any = await POST(postReq({ slug: 'acme', mode: 'weekly' }))
    expect(res.status).toBe(400)
    expect(h.setAppCommsMode).not.toHaveBeenCalled()
  })

  it('400s when mode is missing entirely', async () => {
    const res: any = await POST(postReq({ slug: 'acme' }))
    expect(res.status).toBe(400)
  })

  it('404s when the company is not registered', async () => {
    h.resolveApp.mockResolvedValue(null)
    const res: any = await POST(postReq({ slug: 'ghost', mode: 'agile' }))
    expect(res.status).toBe(404)
    expect(h.setAppCommsMode).not.toHaveBeenCalled()
  })

  it('persists a valid mode and returns { ok: true, mode }', async () => {
    const res: any = await POST(postReq({ slug: 'acme', mode: 'pairProgramming' }))
    const json = await res.json()
    expect(json).toEqual({ ok: true, mode: 'pairProgramming' })
    expect(h.setAppCommsMode).toHaveBeenCalledWith('acme', 'pairProgramming')
  })

  it('accepts the agile mode too', async () => {
    const res: any = await POST(postReq({ slug: 'acme', mode: 'agile' }))
    const json = await res.json()
    expect(json).toEqual({ ok: true, mode: 'agile' })
  })

  it('surfaces a real persistence failure honestly, never fabricates success', async () => {
    h.setAppCommsMode.mockResolvedValue(false)
    const res: any = await POST(postReq({ slug: 'acme', mode: 'agile' }))
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })
})
