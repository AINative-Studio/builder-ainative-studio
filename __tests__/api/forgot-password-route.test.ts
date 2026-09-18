import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #7698 — /api/auth/forgot-password proxies to CORE (Builder has no AINative
 * password store of its own) and identifies itself with app:'builder' so the
 * reset email is Builder-branded and its link returns to builder.ainative.studio
 * rather than ainative.studio.
 *
 * Live bug this closes (jeromepalencia@gmail.com, 2026-09-18): Builder's forgot
 * button was a stub, and core had no way to know a reset came from Builder.
 */

import { POST } from '@/app/api/auth/forgot-password/route'

const CORE = 'https://api.ainative.studio'

function req(body: unknown) {
  return new Request('https://builder.ainative.studio/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: 'ok' }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('POST /api/auth/forgot-password — request a reset (#7698)', () => {
  it('proxies to core /api/v1/auth/forgot-password with app:"builder"', async () => {
    const res = await POST(req({ email: 'founder@example.com' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${CORE}/api/v1/auth/forgot-password`)
    expect(init.method).toBe('POST')

    const sent = JSON.parse(String(init.body))
    // The whole point of the fix: core must be told which app asked.
    expect(sent.app).toBe('builder')
    expect(sent.email).toBe('founder@example.com')
  })

  it('normalizes the email before proxying', async () => {
    await POST(req({ email: '  Founder@Example.COM ' }))
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as any)[1].body))
    expect(sent.email).toBe('founder@example.com')
  })

  it('rejects an invalid email without calling core', async () => {
    const res = await POST(req({ email: 'not-an-email' }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never reveals whether the account exists', async () => {
    const res = await POST(req({ email: 'nobody@example.com' }))
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(JSON.stringify(body)).not.toMatch(/not found|no such|unknown/i)
  })

  it('surfaces core rate limiting plainly instead of a generic failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 429 }))
    const res = await POST(req({ email: 'founder@example.com' }))
    expect(res.status).toBe(429)
    expect((await res.json()).error).toMatch(/too many/i)
  })

  it('returns 502 when core is unreachable, never a 500 stack', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const res = await POST(req({ email: 'founder@example.com' }))
    expect(res.status).toBe(502)
    expect((await res.json()).ok).toBe(false)
  })
})

describe('POST /api/auth/forgot-password — action:"reset" (#7698)', () => {
  const TOKEN = 'token-from-the-email-link'
  const NEW_PASSWORD = 'a-new-passphrase'

  it('proxies to core /api/v1/auth/reset-password using its {token,new_password} contract', async () => {
    const res = await POST(req({ action: 'reset', token: TOKEN, password: NEW_PASSWORD }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${CORE}/api/v1/auth/reset-password`)
    const sent = JSON.parse(String(init.body))
    expect(sent).toEqual({ token: TOKEN, new_password: NEW_PASSWORD })
    // Core's field is new_password — sending `password` would silently 422.
    expect(sent.password).toBeUndefined()
  })

  it('rejects a missing token without calling core', async () => {
    const res = await POST(req({ action: 'reset', token: '', password: NEW_PASSWORD }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a too-short password without calling core', async () => {
    const res = await POST(req({ action: 'reset', token: TOKEN, password: 'short' }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces core\'s reason for an expired or already-used token', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Invalid or expired reset token' }), { status: 400 }),
    )
    const res = await POST(req({ action: 'reset', token: TOKEN, password: NEW_PASSWORD }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/expired/i)
  })
})
