import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * POST /api/build/voice/token — #1290, the server-side Hume EVI access
 * token mint. Hume's own Next.js quickstart (HumeAI/hume-api-examples,
 * evi/evi-next-js-app-router-quickstart) mints this via the `hume` SDK's
 * fetchAccessToken({ apiKey, secretKey }) — two long-lived server secrets
 * that must never reach the browser. This route is the only thing that
 * calls fetchAccessToken; the client only ever sees the short-lived token
 * this route hands back.
 *
 * Properties under test:
 *  - missing config (no HUME_API_KEY/HUME_SECRET_KEY) → 404,
 *    VOICE_NOT_CONFIGURED, and fetchAccessToken is never called;
 *  - configured + a real token comes back → 200 with { ok: true, accessToken };
 *  - configured but Hume's call throws → 502, TOKEN_FETCH_FAILED, never a
 *    fabricated success;
 *  - configured but Hume returns an empty/falsy token → 502, TOKEN_FETCH_FAILED.
 */

const h = vi.hoisted(() => ({ fetchAccessToken: vi.fn() }))
vi.mock('hume', () => ({ fetchAccessToken: h.fetchAccessToken }))

const ORIGINAL_ENV = { ...process.env }

describe('POST /api/build/voice/token', () => {
  beforeEach(() => {
    vi.resetModules()
    h.fetchAccessToken.mockReset()
    delete process.env.HUME_API_KEY
    delete process.env.HUME_SECRET_KEY
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('returns 404 VOICE_NOT_CONFIGURED when Hume keys are unset, without calling Hume', async () => {
    const { POST } = await import('@/app/api/build/voice/token/route')
    const res = await POST()
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data).toEqual({ ok: false, error: 'VOICE_NOT_CONFIGURED' })
    expect(h.fetchAccessToken).not.toHaveBeenCalled()
  })

  it('returns 404 when only HUME_API_KEY is set (secret key still missing)', async () => {
    process.env.HUME_API_KEY = 'hume-key'
    const { POST } = await import('@/app/api/build/voice/token/route')
    const res = await POST()
    expect(res.status).toBe(404)
    expect(h.fetchAccessToken).not.toHaveBeenCalled()
  })

  it('returns the real access token when both keys are configured and Hume succeeds', async () => {
    process.env.HUME_API_KEY = 'hume-key'
    process.env.HUME_SECRET_KEY = 'hume-secret'
    h.fetchAccessToken.mockResolvedValue('real-short-lived-token')
    const { POST } = await import('@/app/api/build/voice/token/route')
    const res = await POST()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ ok: true, accessToken: 'real-short-lived-token' })
    expect(h.fetchAccessToken).toHaveBeenCalledWith({ apiKey: 'hume-key', secretKey: 'hume-secret' })
  })

  it('returns 502 TOKEN_FETCH_FAILED when Hume throws', async () => {
    process.env.HUME_API_KEY = 'hume-key'
    process.env.HUME_SECRET_KEY = 'hume-secret'
    h.fetchAccessToken.mockRejectedValue(new Error('network down'))
    const { POST } = await import('@/app/api/build/voice/token/route')
    const res = await POST()
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ ok: false, error: 'TOKEN_FETCH_FAILED' })
  })

  it('returns 502 TOKEN_FETCH_FAILED when Hume returns an empty token (never fabricates success)', async () => {
    process.env.HUME_API_KEY = 'hume-key'
    process.env.HUME_SECRET_KEY = 'hume-secret'
    h.fetchAccessToken.mockResolvedValue('')
    const { POST } = await import('@/app/api/build/voice/token/route')
    const res = await POST()
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ ok: false, error: 'TOKEN_FETCH_FAILED' })
  })
})
