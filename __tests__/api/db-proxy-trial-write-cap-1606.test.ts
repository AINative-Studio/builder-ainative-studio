import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1606 — /api/db/{table}'s write handlers must enforce the trial write cap
 * ONLY for a `usageTier: 'trial'` key, and NEVER for reads.
 *
 * Invariants under test:
 *  (a) GET never calls the cap check at all, under any usageTier.
 *  (b) POST/PUT/DELETE call the cap check ONLY when usageTier is 'trial'.
 *  (c) A capped write returns the distinct usage_capped response (402),
 *      never forwarded to ZeroDB at all.
 *  (d) A 'paid' or undefined usageTier key is NEVER subject to the cap,
 *      however it resolves — full regression safety for every paying/
 *      claimed company and the shared/legacy project.
 */

const h = vi.hoisted(() => ({
  resolveCompanyZerodbKey: vi.fn(),
  checkAndRecordTrialWrite: vi.fn(),
}))

vi.mock('@/lib/build/company-zerodb-credentials', () => ({
  resolveCompanyZerodbKey: h.resolveCompanyZerodbKey,
}))
vi.mock('@/lib/build/trial-write-cap', () => ({
  checkAndRecordTrialWrite: h.checkAndRecordTrialWrite,
}))

process.env.AUTH_SECRET = 'test-secret-for-token-signing'

import { GET, POST, PUT, DELETE } from '@/app/api/db/[table]/route'
import { mintAppDataToken } from '@/lib/build/app-data-token'

const COMPANY_PROJECT = 'company-own-project-uuid'
const companyToken = () => mintAppDataToken(COMPANY_PROJECT, 'acme', Math.floor(Date.now() / 1000))

function req(url: string, opts: { token?: string; body?: any } = {}) {
  const nextUrl = new URL(url)
  const headers = new Map<string, string>()
  if (opts.token) headers.set('x-ainative-db-token', opts.token)
  return {
    nextUrl,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    json: async () => opts.body ?? {},
  } as any
}

const params = (table: string) => ({ params: Promise.resolve({ table }) })

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('/api/db/{table} — trial write cap wiring (#1606)', () => {
  it('(a) GET never calls the cap check, even for a trial-tier key', async () => {
    h.resolveCompanyZerodbKey.mockResolvedValue({ ok: true, apiKey: 'tmp_x', usageTier: 'trial' })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })))

    const res: any = await GET(req('http://x/api/db/waitlist', { token: companyToken() }), params('waitlist'))
    expect(res.status).toBe(200)
    expect(h.checkAndRecordTrialWrite).not.toHaveBeenCalled()
  })

  it('(b) POST calls the cap check for a trial-tier key, and forwards to ZeroDB when allowed', async () => {
    h.resolveCompanyZerodbKey.mockResolvedValue({ ok: true, apiKey: 'tmp_x', usageTier: 'trial' })
    h.checkAndRecordTrialWrite.mockResolvedValue({ allowed: true, count: 1, cap: 5000 })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) })))

    const res: any = await POST(
      req('http://x/api/db/waitlist', { token: companyToken(), body: { email: 'a@b.com' } }),
      params('waitlist'),
    )
    expect(res.status).toBe(200)
    expect(h.checkAndRecordTrialWrite).toHaveBeenCalledWith(COMPANY_PROJECT)
  })

  it('(c) POST DENIED by the cap returns a distinct usage_capped 402, never reaches ZeroDB', async () => {
    h.resolveCompanyZerodbKey.mockResolvedValue({ ok: true, apiKey: 'tmp_x', usageTier: 'trial' })
    h.checkAndRecordTrialWrite.mockResolvedValue({ allowed: false, count: 5000, cap: 5000 })
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) }))
    vi.stubGlobal('fetch', fetchMock)

    const res: any = await POST(
      req('http://x/api/db/waitlist', { token: companyToken(), body: { email: 'a@b.com' } }),
      params('waitlist'),
    )
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.reason).toBe('usage_capped')
    expect(body.error).toBe('usage_capped')
    // Never forwarded the write to ZeroDB once denied.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('(c) PUT DENIED by the cap returns usage_capped, never reaches ZeroDB', async () => {
    h.resolveCompanyZerodbKey.mockResolvedValue({ ok: true, apiKey: 'tmp_x', usageTier: 'trial' })
    h.checkAndRecordTrialWrite.mockResolvedValue({ allowed: false, count: 5000, cap: 5000 })
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) }))
    vi.stubGlobal('fetch', fetchMock)

    const res: any = await PUT(
      req('http://x/api/db/waitlist?id=row-1', { token: companyToken(), body: { email: 'a@b.com' } }),
      params('waitlist'),
    )
    expect(res.status).toBe(402)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('(c) DELETE DENIED by the cap returns usage_capped, never reaches ZeroDB', async () => {
    h.resolveCompanyZerodbKey.mockResolvedValue({ ok: true, apiKey: 'tmp_x', usageTier: 'trial' })
    h.checkAndRecordTrialWrite.mockResolvedValue({ allowed: false, count: 5000, cap: 5000 })
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) }))
    vi.stubGlobal('fetch', fetchMock)

    const res: any = await DELETE(req('http://x/api/db/waitlist?id=row-1', { token: companyToken() }), params('waitlist'))
    expect(res.status).toBe(402)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("(d) a 'paid' usageTier key is NEVER subject to the cap — the check is never even called", async () => {
    h.resolveCompanyZerodbKey.mockResolvedValue({ ok: true, apiKey: 'sk_paid', usageTier: 'paid' })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) })))

    const res: any = await POST(
      req('http://x/api/db/waitlist', { token: companyToken(), body: { email: 'a@b.com' } }),
      params('waitlist'),
    )
    expect(res.status).toBe(200)
    expect(h.checkAndRecordTrialWrite).not.toHaveBeenCalled()
  })

  it("(d) an UNDEFINED usageTier (legacy row stored before #1606, or a claimed/paid company) is never capped either", async () => {
    h.resolveCompanyZerodbKey.mockResolvedValue({ ok: true, apiKey: 'sk_legacy' }) // no usageTier field at all
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) })))

    const res: any = await POST(
      req('http://x/api/db/waitlist', { token: companyToken(), body: { email: 'a@b.com' } }),
      params('waitlist'),
    )
    expect(res.status).toBe(200)
    expect(h.checkAndRecordTrialWrite).not.toHaveBeenCalled()
  })

  it('(d) the shared/legacy no-token project is never subject to the cap', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) })))
    const res: any = await POST(req('http://x/api/db/waitlist', { body: { email: 'a@b.com' } }), params('waitlist'))
    expect(res.status).toBe(200)
    expect(h.resolveCompanyZerodbKey).not.toHaveBeenCalled()
    expect(h.checkAndRecordTrialWrite).not.toHaveBeenCalled()
  })
})
