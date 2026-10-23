import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1202 (Coverage Phase 2 follow-up) — app/api/build/lead/route.ts (#207)
 * had zero route-level coverage. Mocks fetch (ZeroDB row write), the ad
 * conversion reporters, and the dynamic lib/build/learning import.
 */

const conversions = vi.hoisted(() => ({
  reportConversion: vi.fn().mockResolvedValue(true),
  gclidFromRequest: vi.fn(() => undefined),
}))
vi.mock('@/lib/build/conversions', () => conversions)

const metaCapi = vi.hoisted(() => ({
  reportMetaConversion: vi.fn().mockResolvedValue(true),
  fbcFromRequest: vi.fn(() => undefined),
  fbpFromRequest: vi.fn(() => undefined),
}))
vi.mock('@/lib/build/meta-capi', () => metaCapi)

const learning = vi.hoisted(() => ({ logBuildOutcome: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/build/learning', () => learning)

vi.mock('@/lib/build/env-keys', () => ({ getAinativeApiKey: () => 'test-key' }))

import { mockJsonRequest } from '../helpers/api-route-harness'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  conversions.reportConversion.mockResolvedValue(true)
  metaCapi.reportMetaConversion.mockResolvedValue(true)
  learning.logBuildOutcome.mockResolvedValue(undefined)
  vi.stubEnv('ZERODB_PROJECT_ID', 'proj-123')
})

describe('#1202 POST /api/build/lead', () => {
  it('returns 400 for an invalid email', async () => {
    const { POST } = await import('@/app/api/build/lead/route')

    const res = await POST(mockJsonRequest('http://localhost/api/build/lead', { email: 'not-an-email' }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toEqual({ ok: false, reason: 'invalid_email' })
  })

  it('degrades gracefully (still ok) when ZERODB_PROJECT_ID is unset', async () => {
    // PROJECT_ID is read into a module-level const at import time, so the env
    // var must be stubbed BEFORE the route module is first imported.
    vi.stubEnv('ZERODB_PROJECT_ID', '')
    vi.resetModules()
    const { POST } = await import('@/app/api/build/lead/route')

    const res = await POST(mockJsonRequest('http://localhost/api/build/lead', { email: 'lead@example.com' }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, stored: false })
    expect(fetchMock).not.toHaveBeenCalled()

    // Restore the module graph + env for subsequent tests in this file.
    vi.stubEnv('ZERODB_PROJECT_ID', 'proj-123')
    vi.resetModules()
  })

  it('persists the lead row and reports ad conversions when a slug is present', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    const { POST } = await import('@/app/api/build/lead/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/lead', {
        email: 'lead@example.com',
        slug: 'acme',
        idea: 'a coffee finder',
        track: 'app',
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, stored: true })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('builder_leads/rows'),
      expect.objectContaining({ method: 'POST' })
    )
    expect(conversions.reportConversion).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'lead_captured', slug: 'acme', email: 'lead@example.com' })
    )
    expect(metaCapi.reportMetaConversion).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'Lead', email: 'lead@example.com' })
    )
  })

  it('reports stored:false when the ZeroDB write itself is not ok', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'bad request' }) })
    const { POST } = await import('@/app/api/build/lead/route')

    const res = await POST(mockJsonRequest('http://localhost/api/build/lead', { email: 'lead@example.com' }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: false, stored: false })
  })

  it('returns 502 when the write throws', async () => {
    fetchMock.mockRejectedValue(new Error('network blip'))
    const { POST } = await import('@/app/api/build/lead/route')

    const res = await POST(mockJsonRequest('http://localhost/api/build/lead', { email: 'lead@example.com' }))

    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.reason).toContain('network blip')
  })

  it('returns 400 when the body is not valid JSON (no email to validate)', async () => {
    const { POST } = await import('@/app/api/build/lead/route')
    const malformed = new Request('http://localhost/api/build/lead', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not valid',
    })

    const res = await POST(malformed as any)

    expect(res.status).toBe(400)
  })
})
