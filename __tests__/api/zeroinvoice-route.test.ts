import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #418 — POST /api/build/zeroinvoice ("Connect ZeroInvoice").
 *
 * Properties under test:
 *  - requires a slug (400 on missing);
 *  - requires sign-in (reason:'signin' when anonymous);
 *  - 404s on an unknown company;
 *  - returns the real authUrl and records the click on success;
 *  - surfaces a real authorize failure honestly, never fabricates success;
 *  - a click-recording hiccup never blocks returning the real authUrl to
 *    the founder (best-effort persistence, per its own doc).
 * All collaborators are mocked; no real network call is made.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveApp: vi.fn(),
  setAppZeroInvoiceConnectClicked: vi.fn(async () => true),
  getZeroInvoiceAuthorizeUrl: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: h.resolveApp,
  setAppZeroInvoiceConnectClicked: h.setAppZeroInvoiceConnectClicked,
}))
vi.mock('@/lib/build/zeroinvoice', () => ({ getZeroInvoiceAuthorizeUrl: h.getZeroInvoiceAuthorizeUrl }))

import { POST } from '@/app/api/build/zeroinvoice/route'

function postReq(body: unknown) {
  return { json: async () => body } as any
}

const APP = { slug: 'acme', chatId: 'c1', createdAt: '2026-08-01T00:00:00Z' }

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ accessToken: 'tok', user: { email: 'f@x.com' } })
  h.resolveApp.mockResolvedValue(APP)
  h.setAppZeroInvoiceConnectClicked.mockResolvedValue(true)
})

describe('POST /api/build/zeroinvoice (#418)', () => {
  it('requires a slug', async () => {
    const res: any = await POST(postReq({}))
    expect(res.status).toBe(400)
    expect(h.auth).not.toHaveBeenCalled()
  })

  it('requires sign-in', async () => {
    h.auth.mockResolvedValue(null)
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'signin' })
    expect(h.getZeroInvoiceAuthorizeUrl).not.toHaveBeenCalled()
  })

  it('404s when the company does not exist', async () => {
    h.resolveApp.mockResolvedValue(null)
    const res: any = await POST(postReq({ slug: 'nope' }))
    expect(res.status).toBe(404)
  })

  it('returns the real authUrl and records the click on success', async () => {
    h.getZeroInvoiceAuthorizeUrl.mockResolvedValue({ ok: true, authUrl: 'https://api.ainative.studio/oauth/authorize?x=1' })
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual({ ok: true, authUrl: 'https://api.ainative.studio/oauth/authorize?x=1' })
    expect(h.setAppZeroInvoiceConnectClicked).toHaveBeenCalledWith('acme')
  })

  it('surfaces a real authorize failure honestly, never fabricates success', async () => {
    h.getZeroInvoiceAuthorizeUrl.mockResolvedValue({ ok: false, reason: 'AINative SSO not configured', status: 503 })
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual(expect.objectContaining({ ok: false, reason: 'AINative SSO not configured', status: 503 }))
    expect(h.setAppZeroInvoiceConnectClicked).not.toHaveBeenCalled()
  })

  it('still returns the real authUrl even when recording the click fails (best-effort)', async () => {
    h.getZeroInvoiceAuthorizeUrl.mockResolvedValue({ ok: true, authUrl: 'https://api.ainative.studio/oauth/authorize?x=1' })
    h.setAppZeroInvoiceConnectClicked.mockRejectedValue(new Error('zerodb hiccup'))
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual({ ok: true, authUrl: 'https://api.ainative.studio/oauth/authorize?x=1' })
  })
})
