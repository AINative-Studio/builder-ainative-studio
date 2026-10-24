import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * POST /api/build/voice/token-elevenlabs — #1468, the server-side ElevenLabs
 * Conversational AI signed-url mint. Mirrors
 * app/api/build/voice/token/route.ts's (Hume, #1290) status-code and
 * response-shape conventions exactly: 404 when unconfigured, 502 when the
 * mint call fails or comes back empty, 200 with the short-lived credential
 * on success. ELEVENLABS_API_KEY must never reach the browser — only the
 * signed URL this route hands back does.
 *
 * ElevenLabs' real Conversational AI REST API mints this via
 * GET https://api.elevenlabs.io/v1/convai/conversation/get-signed-url
 * with an `xi-api-key` header and an `agent_id` query param, returning
 * { signed_url }. Calling global fetch directly here (rather than pulling
 * in the full `elevenlabs` server SDK, which the issue doesn't ask for)
 * keeps this route's only new dependency the ones issue #1468 lists.
 */

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_FETCH = global.fetch

describe('POST /api/build/voice/token-elevenlabs', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.ELEVENLABS_API_KEY
    delete process.env.ELEVENLABS_AGENT_ID
    global.fetch = vi.fn()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    global.fetch = ORIGINAL_FETCH
  })

  it('returns 404 VOICE_NOT_CONFIGURED when ElevenLabs vars are unset, without calling ElevenLabs', async () => {
    const { POST } = await import('@/app/api/build/voice/token-elevenlabs/route')
    const res = await POST()
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data).toEqual({ ok: false, error: 'VOICE_NOT_CONFIGURED' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns 404 when only ELEVENLABS_API_KEY is set (agent id still missing)', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-key'
    const { POST } = await import('@/app/api/build/voice/token-elevenlabs/route')
    const res = await POST()
    expect(res.status).toBe(404)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns the real signed url when both vars are configured and ElevenLabs succeeds', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-key'
    process.env.ELEVENLABS_AGENT_ID = 'el-agent'
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ signed_url: 'wss://real-signed-url' }),
    })
    const { POST } = await import('@/app/api/build/voice/token-elevenlabs/route')
    const res = await POST()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ ok: true, signedUrl: 'wss://real-signed-url' })
    const [url, init] = (global.fetch as any).mock.calls[0]
    expect(String(url)).toContain('agent_id=el-agent')
    expect(init.headers['xi-api-key']).toBe('el-key')
  })

  it('returns 502 TOKEN_FETCH_FAILED when the ElevenLabs call throws', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-key'
    process.env.ELEVENLABS_AGENT_ID = 'el-agent'
    ;(global.fetch as any).mockRejectedValue(new Error('network down'))
    const { POST } = await import('@/app/api/build/voice/token-elevenlabs/route')
    const res = await POST()
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ ok: false, error: 'TOKEN_FETCH_FAILED' })
  })

  it('returns 502 TOKEN_FETCH_FAILED when ElevenLabs responds non-ok', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-key'
    process.env.ELEVENLABS_AGENT_ID = 'el-agent'
    ;(global.fetch as any).mockResolvedValue({ ok: false, json: async () => ({}) })
    const { POST } = await import('@/app/api/build/voice/token-elevenlabs/route')
    const res = await POST()
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ ok: false, error: 'TOKEN_FETCH_FAILED' })
  })

  it('returns 502 TOKEN_FETCH_FAILED when ElevenLabs returns an empty signed_url (never fabricates success)', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-key'
    process.env.ELEVENLABS_AGENT_ID = 'el-agent'
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ signed_url: '' }) })
    const { POST } = await import('@/app/api/build/voice/token-elevenlabs/route')
    const res = await POST()
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ ok: false, error: 'TOKEN_FETCH_FAILED' })
  })
})
