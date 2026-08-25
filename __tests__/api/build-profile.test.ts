import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #57 — /api/build/profile route.
 *   - GET/POST require a REAL (non-guest) session (401 otherwise).
 *   - POST validates the body (400 on invalid) before touching core.
 *   - the access token comes from the SERVER session only.
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  loadCoreProfile: vi.fn(),
  updateCoreProfile: vi.fn(),
}))
vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/profile', async (orig) => {
  const actual = await (orig as any)()
  return { ...actual, loadCoreProfile: h.loadCoreProfile, updateCoreProfile: h.updateCoreProfile }
})
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

import { GET, POST } from '@/app/api/build/profile/route'
import { AINativeApiError } from '@/lib/ainative/types'

function req(body: unknown) {
  return { json: async () => body } as any
}

const REAL = { user: { email: 'ada@x.com', type: 'ainative' }, accessToken: 'tok-123' }
const GUEST = { user: { email: 'guest-1@example.com', type: 'guest' }, accessToken: 'tok-guest' }

beforeEach(() => {
  h.auth.mockReset()
  h.loadCoreProfile.mockReset()
  h.updateCoreProfile.mockReset()
})

describe('GET /api/build/profile (#57)', () => {
  it('401 when unauthenticated', async () => {
    h.auth.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(h.loadCoreProfile).not.toHaveBeenCalled()
  })

  it('401 for a guest session', async () => {
    h.auth.mockResolvedValue(GUEST)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(h.loadCoreProfile).not.toHaveBeenCalled()
  })

  it('returns the profile for a real session using the session token', async () => {
    h.auth.mockResolvedValue(REAL)
    h.loadCoreProfile.mockResolvedValue({ fullName: 'Ada', email: 'ada@x.com', social: '', contentLanguage: 'es' })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.profile.contentLanguage).toBe('es')
    expect(h.loadCoreProfile).toHaveBeenCalledWith('tok-123')
  })

  it('maps a core load failure to its status', async () => {
    h.auth.mockResolvedValue(REAL)
    h.loadCoreProfile.mockRejectedValue(new AINativeApiError('gone', 404))
    const res = await GET()
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('could not load profile')
  })
})

describe('POST /api/build/profile (#57)', () => {
  it('401 for a guest session (no durable account)', async () => {
    h.auth.mockResolvedValue(GUEST)
    const res = await POST(req({ fullName: 'A', email: 'a@b.co', contentLanguage: 'en' }))
    expect(res.status).toBe(401)
    expect(h.updateCoreProfile).not.toHaveBeenCalled()
  })

  it('400 on an invalid body (never calls core)', async () => {
    h.auth.mockResolvedValue(REAL)
    const res = await POST(req({ fullName: '', email: 'nope', contentLanguage: 'en' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_profile')
    expect(body.fields).toBeTruthy()
    expect(h.updateCoreProfile).not.toHaveBeenCalled()
  })

  it('persists a valid profile via the session token and returns it', async () => {
    h.auth.mockResolvedValue(REAL)
    h.updateCoreProfile.mockResolvedValue({ fullName: 'Ada', email: 'ada@x.com', social: 'ada_l', contentLanguage: 'es' })
    const res = await POST(req({ fullName: ' Ada ', email: 'ada@x.com', social: '@ada_l', contentLanguage: 'es' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.profile.contentLanguage).toBe('es')
    const [tokenArg, profileArg] = h.updateCoreProfile.mock.calls[0]
    expect(tokenArg).toBe('tok-123')
    expect(profileArg.social).toBe('ada_l') // normalized before persist
  })

  it('surfaces a 4xx core error message, but hides 5xx detail', async () => {
    h.auth.mockResolvedValue(REAL)
    h.updateCoreProfile.mockRejectedValue(new AINativeApiError('email already taken', 409))
    const res = await POST(req({ fullName: 'Ada', email: 'ada@x.com', contentLanguage: 'en' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('email already taken')
  })

  it('returns 502 with a generic message on a core 5xx', async () => {
    h.auth.mockResolvedValue(REAL)
    h.updateCoreProfile.mockRejectedValue(new AINativeApiError('boom', 500))
    const res = await POST(req({ fullName: 'Ada', email: 'ada@x.com', contentLanguage: 'en' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('could not save profile')
  })
})
