import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #53 — POST/GET /api/build/connect-domain (bring-your-own domain).
 *
 * Properties under test:
 *  - requires a valid domain + slug (400 on junk);
 *  - requires sign-in (reason:'signin' when anonymous);
 *  - a shared-origin (non-provisioned) company → needs_provision (can't CNAME);
 *  - a provisioned company → calls createCustomDomain and returns DNS records + status;
 *  - GET polls status honestly and, when Railway hasn't seen DNS yet, falls back to a
 *    DoH pre-check to advance pending → verifying;
 *  - GET on a bare re-open (no domain) surfaces the already-connected domain (idempotent).
 * All collaborators are mocked; no real network/Railway call is made.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveAppVerified: vi.fn(),
  setAppByoDomain: vi.fn(async () => true),
  createCustomDomain: vi.fn(),
  getCustomDomainStatus: vi.fn(),
  checkDnsRecord: vi.fn(async () => false),
  railwayApiConfigured: vi.fn(() => true),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', () => ({
  resolveAppVerified: h.resolveAppVerified,
  setAppByoDomain: h.setAppByoDomain,
}))
vi.mock('@/lib/build/railway-deploy', async () => {
  const actual = await vi.importActual<any>('@/lib/build/railway-deploy')
  return {
    ...actual, // keep real normalizeDomain / isValidCustomDomain
    createCustomDomain: h.createCustomDomain,
    getCustomDomainStatus: h.getCustomDomainStatus,
    checkDnsRecord: h.checkDnsRecord,
    railwayApiConfigured: h.railwayApiConfigured,
  }
})

import { POST, GET } from '@/app/api/build/connect-domain/route'

function postReq(body: unknown) {
  return { json: async () => body } as any
}
function getReq(qs: string) {
  return { url: `https://builder.ainative.studio/api/build/connect-domain?${qs}` } as any
}
/** A confirmed resolveAppVerified() result — either a real entry or a confirmed miss. */
function verified(entry: Record<string, unknown> | null) {
  return { entry, verified: true }
}

const PROVISIONED = {
  slug: 'acme', chatId: 'c1', createdAt: '2026-08-01T00:00:00Z',
  railwayServiceId: 'svc-1', deployUrl: 'https://acme.up.railway.app',
}

beforeEach(() => {
  h.auth.mockResolvedValue({ accessToken: 'tok', user: { email: 'f@x.com' } })
  h.railwayApiConfigured.mockReturnValue(true)
  h.checkDnsRecord.mockResolvedValue(false)
})
afterEach(() => vi.clearAllMocks())

describe('POST /api/build/connect-domain', () => {
  it('400 on a missing slug', async () => {
    const res = await POST(postReq({ domain: 'myco.com' }))
    expect(res.status).toBe(400)
  })

  it('400 on an invalid domain', async () => {
    const res = await POST(postReq({ slug: 'acme', domain: 'not-a-domain' }))
    expect(res.status).toBe(400)
  })

  it('requires sign-in when anonymous', async () => {
    h.auth.mockResolvedValueOnce(null)
    const res = await POST(postReq({ slug: 'acme', domain: 'myco.com' }))
    const body = await res.json()
    expect(body.reason).toBe('signin')
  })

  it('404 when the company is not registered', async () => {
    h.resolveAppVerified.mockResolvedValueOnce(verified(null))
    const res = await POST(postReq({ slug: 'ghost', domain: 'myco.com' }))
    expect(res.status).toBe(404)
  })

  it('503 lookup_failed when the registry read itself fails (NOT a false 404)', async () => {
    h.resolveAppVerified.mockResolvedValueOnce({ entry: null, verified: false })
    const res = await POST(postReq({ slug: 'acme', domain: 'myco.com' }))
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body.reason).toBe('lookup_failed')
  })

  it('503 lookup_failed when resolveAppVerified rejects outright', async () => {
    h.resolveAppVerified.mockRejectedValueOnce(new Error('zerodb timeout'))
    const res = await POST(postReq({ slug: 'acme', domain: 'myco.com' }))
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body.reason).toBe('lookup_failed')
  })

  it('needs_provision for a shared-origin (non-provisioned) company', async () => {
    h.resolveAppVerified.mockResolvedValueOnce(verified({ slug: 'acme', chatId: 'c1' })) // no railwayServiceId
    const res = await POST(postReq({ slug: 'acme', domain: 'myco.com' }))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.needs_provision).toBe(true)
    expect(h.createCustomDomain).not.toHaveBeenCalled()
  })

  it('connects a domain on a provisioned company and returns DNS records + status', async () => {
    h.resolveAppVerified.mockResolvedValueOnce(verified(PROVISIONED))
    h.createCustomDomain.mockResolvedValueOnce({
      ok: true, id: 'cd-1', domain: 'myco.com', status: 'verifying',
      dnsRecords: [{ type: 'CNAME', name: 'myco.com', value: 'acme.up.railway.app' }],
      cnameTarget: 'acme.up.railway.app',
    })
    const res = await POST(postReq({ slug: 'acme', domain: 'HTTPS://MyCo.com/' }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.domain).toBe('myco.com')
    expect(body.status).toBe('verifying')
    expect(body.dnsRecords[0].value).toBe('acme.up.railway.app')
    // createCustomDomain got the service id + normalised domain + CNAME target (host of deployUrl).
    expect(h.createCustomDomain).toHaveBeenCalledWith('svc-1', 'myco.com', undefined, 'acme.up.railway.app')
    // Connection persisted for idempotent re-opens.
    expect(h.setAppByoDomain).toHaveBeenCalledWith('acme', expect.objectContaining({ domain: 'myco.com', byoDomainId: 'cd-1' }))
  })
})

describe('GET /api/build/connect-domain', () => {
  it('400 on a missing slug', async () => {
    const res = await GET(getReq(''))
    expect(res.status).toBe(400)
  })

  it('reports not-connected when no domain is known', async () => {
    h.resolveAppVerified.mockResolvedValueOnce(verified(PROVISIONED)) // no byoDomain
    const res = await GET(getReq('slug=acme'))
    const body = await res.json()
    expect(body.connected).toBe(false)
    expect(body.status).toBeNull()
  })

  it('503 lookup_failed on GET when the registry read itself fails (NOT a false 404)', async () => {
    h.resolveAppVerified.mockResolvedValueOnce({ entry: null, verified: false })
    const res = await GET(getReq('slug=acme'))
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body.reason).toBe('lookup_failed')
  })

  it('advances pending → verifying via the DoH pre-check when Railway has not seen DNS', async () => {
    h.resolveAppVerified.mockResolvedValueOnce(verified(PROVISIONED))
    h.getCustomDomainStatus.mockResolvedValueOnce({ ok: true, id: 'cd-1', status: 'pending', dnsRecords: [] })
    h.checkDnsRecord.mockResolvedValueOnce(true) // DNS now resolves toward the target
    const res = await GET(getReq('slug=acme&domain=myco.com'))
    const body = await res.json()
    expect(body.status).toBe('verifying')
    expect(h.checkDnsRecord).toHaveBeenCalledWith('myco.com', 'acme.up.railway.app')
  })

  it('surfaces an already-connected domain on a bare re-open (idempotent)', async () => {
    h.resolveAppVerified.mockResolvedValueOnce(verified({ ...PROVISIONED, byoDomain: 'myco.com', byoDomainStatus: 'live' }))
    h.getCustomDomainStatus.mockResolvedValueOnce({ ok: true, id: 'cd-1', status: 'live', dnsRecords: [] })
    const res = await GET(getReq('slug=acme')) // no domain param
    const body = await res.json()
    expect(body.connected).toBe(true)
    expect(body.domain).toBe('myco.com')
    expect(body.status).toBe('live')
  })

  it('does NOT report live when only DNS resolves (cert still issuing)', async () => {
    h.resolveAppVerified.mockResolvedValueOnce(verified(PROVISIONED))
    h.getCustomDomainStatus.mockResolvedValueOnce({ ok: true, id: 'cd-1', status: 'pending', dnsRecords: [] })
    h.checkDnsRecord.mockResolvedValueOnce(true)
    const res = await GET(getReq('slug=acme&domain=myco.com'))
    const body = await res.json()
    expect(body.status).not.toBe('live')
  })
})
