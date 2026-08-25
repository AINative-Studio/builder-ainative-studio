import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  normalizeDomain,
  isValidCustomDomain,
  mapCustomDomainStatus,
  createCustomDomain,
  getCustomDomainStatus,
  checkDnsRecord,
} from '@/lib/build/railway-deploy'

/**
 * #53 — bring-your-own custom domain on a provisioned Railway service.
 *
 * Safety properties under test:
 *  - the connect path is INERT (reason:'disabled') and makes NO Railway call unless
 *    Railway provisioning is explicitly enabled + configured (cost/side-effect safe);
 *  - status mapping is HONEST — it never reports 'live' unless the cert is active;
 *  - re-connecting an already-attached domain is idempotent (falls back to status);
 *  - domain validation rejects junk before it ever reaches Railway.
 *
 * global fetch is mocked so NO real Railway/DoH request is ever made.
 */
function gql(data: unknown): Response {
  return { ok: true, status: 200, text: async () => JSON.stringify({ data }) } as unknown as Response
}

function enableRailway() {
  vi.stubEnv('RAILWAY_DEPLOY_ENABLED', 'true')
  vi.stubEnv('RAILWAY_TOKEN', 'test-token')
  vi.stubEnv('RAILWAY_COMPANY_PROJECT_ID', 'proj-123')
  vi.stubEnv('RAILWAY_COMPANY_ENVIRONMENT_ID', 'env-123')
  vi.stubEnv('RAILWAY_COMPANY_SOURCE_IMAGE', 'ghcr.io/ainative/company-runtime:latest')
}

describe('normalizeDomain', () => {
  it('strips scheme, path, port and trailing dot, lowercases', () => {
    expect(normalizeDomain('HTTPS://Myco.com/app/x?y=1')).toBe('myco.com')
    expect(normalizeDomain('myco.com:8080')).toBe('myco.com')
    expect(normalizeDomain('MyCo.COM.')).toBe('myco.com')
    expect(normalizeDomain('  app.myco.com  ')).toBe('app.myco.com')
  })
  it('returns empty for empty/whitespace input', () => {
    expect(normalizeDomain('')).toBe('')
    expect(normalizeDomain('   ')).toBe('')
  })
})

describe('isValidCustomDomain', () => {
  it('accepts registrable domains and subdomains', () => {
    expect(isValidCustomDomain('myco.com')).toBe(true)
    expect(isValidCustomDomain('app.myco.com')).toBe(true)
    expect(isValidCustomDomain('my-co.io')).toBe(true)
    expect(isValidCustomDomain('HTTPS://myco.co.uk/')).toBe(true)
  })
  it('rejects bare words, spaces, and invalid TLDs', () => {
    expect(isValidCustomDomain('myco')).toBe(false)
    expect(isValidCustomDomain('my co.com')).toBe(false)
    expect(isValidCustomDomain('myco.c')).toBe(false)      // TLD too short
    expect(isValidCustomDomain('myco.123')).toBe(false)    // numeric TLD
    expect(isValidCustomDomain('')).toBe(false)
    expect(isValidCustomDomain('-bad.com')).toBe(false)    // label starts with hyphen
  })
})

describe('mapCustomDomainStatus — honest lifecycle (never a false live)', () => {
  it('reports live only when the cert is active', () => {
    expect(mapCustomDomainStatus({ certificateStatus: 'ISSUED' })).toBe('live')
    expect(mapCustomDomainStatus({ status: 'ACTIVE' })).toBe('live')
    expect(mapCustomDomainStatus({ certificateStatus: 'ACTIVE' })).toBe('live')
  })
  it('reports verifying when DNS is seen but the cert is still issuing', () => {
    expect(mapCustomDomainStatus({ status: 'WAITING_CERTIFICATE' })).toBe('verifying')
    expect(mapCustomDomainStatus({ certificateStatus: 'ISSUING' })).toBe('verifying')
    expect(
      mapCustomDomainStatus({ dnsRecords: [{ status: 'PROPAGATED' }, { status: 'PROPAGATED' }] }),
    ).toBe('verifying')
  })
  it('does NOT report live when DNS resolves but cert not issued', () => {
    // The critical anti-false-positive: propagated DNS alone is verifying, not live.
    expect(
      mapCustomDomainStatus({ status: 'WAITING', dnsRecords: [{ status: 'PROPAGATED' }] }),
    ).not.toBe('live')
  })
  it('reports pending when records are not yet detected', () => {
    expect(mapCustomDomainStatus({ dnsRecords: [{ status: 'WAITING' }] })).toBe('pending')
    expect(mapCustomDomainStatus({})).toBe('pending')
  })
  it('reports error on failed/error states', () => {
    expect(mapCustomDomainStatus({ status: 'ERROR' })).toBe('error')
    expect(mapCustomDomainStatus({ certificateStatus: 'FAILED' })).toBe('error')
  })
})

describe('createCustomDomain — cost/side-effect safety + shape', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('is INERT (disabled) with NO fetch when Railway is not enabled', async () => {
    const res = await createCustomDomain('svc-1', 'myco.com')
    expect(res).toEqual({ ok: false, reason: 'disabled' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects an invalid domain WITHOUT any fetch', async () => {
    enableRailway()
    const res = await createCustomDomain('svc-1', 'not-a-domain')
    expect(res).toEqual({ ok: false, reason: 'bad_domain' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects when no service id given', async () => {
    enableRailway()
    const res = await createCustomDomain('', 'myco.com')
    expect(res).toEqual({ ok: false, reason: 'no_service' })
  })

  it('creates the custom domain and returns DNS records + honest status', async () => {
    enableRailway()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      gql({
        customDomainCreate: {
          id: 'cd-1',
          domain: 'myco.com',
          status: 'WAITING',
          certificateStatus: 'ISSUING',
          dnsRecords: [
            { hostlabel: 'myco.com', recordType: 'CNAME', requiredValue: 'acme.up.railway.app', status: 'WAITING' },
            { hostlabel: '_railway-verify.myco.com', recordType: 'TXT', requiredValue: 'railway-verify=abc', status: 'WAITING' },
          ],
        },
      }),
    )
    const res = await createCustomDomain('svc-1', 'HTTPS://MyCo.com/', 'env-x', 'acme.up.railway.app')
    expect(res.ok).toBe(true)
    expect(res.id).toBe('cd-1')
    expect(res.domain).toBe('myco.com')
    expect(res.status).toBe('verifying')
    expect(res.dnsRecords).toHaveLength(2)
    expect(res.dnsRecords?.[0]).toMatchObject({ type: 'CNAME', value: 'acme.up.railway.app' })
    expect(res.cnameTarget).toBe('acme.up.railway.app')
  })

  it('is IDEMPOTENT — an already-registered domain falls back to a status read', async () => {
    enableRailway()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    // create throws "already exists" ...
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      text: async () => JSON.stringify({ errors: [{ message: 'domain already exists on service' }] }),
    } as unknown as Response)
    // ... so it reads status, which returns the existing domain, live.
    fetchMock.mockResolvedValueOnce(
      gql({ domains: { customDomains: [{ id: 'cd-1', domain: 'myco.com', certificateStatus: 'ISSUED', dnsRecords: [] }] } }),
    )
    const res = await createCustomDomain('svc-1', 'myco.com', 'env-x', 'acme.up.railway.app')
    expect(res.ok).toBe(true)
    expect(res.status).toBe('live')
    expect(res.id).toBe('cd-1')
  })
})

describe('getCustomDomainStatus', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('is disabled + no fetch when Railway not enabled', async () => {
    const res = await getCustomDomainStatus('svc-1', 'myco.com')
    expect(res).toEqual({ ok: false, reason: 'disabled' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns not_found when the domain is not attached to the service', async () => {
    enableRailway()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(gql({ domains: { customDomains: [{ domain: 'other.com' }] } }))
    const res = await getCustomDomainStatus('svc-1', 'myco.com', 'env-x')
    expect(res).toEqual({ ok: false, reason: 'not_found' })
  })

  it('surfaces live status for a connected + certed domain (idempotent re-open)', async () => {
    enableRailway()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      gql({ domains: { customDomains: [{ id: 'cd-1', domain: 'myco.com', status: 'ACTIVE', dnsRecords: [] }] } }),
    )
    const res = await getCustomDomainStatus('svc-1', 'MyCo.com', 'env-x')
    expect(res.ok).toBe(true)
    expect(res.status).toBe('live')
  })
})

describe('checkDnsRecord — DoH pre-check (pure network, no Railway token)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('returns true when the CNAME answer contains the expected target', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Answer: [{ data: 'acme.up.railway.app.' }] }),
    } as unknown as Response)
    const seen = await checkDnsRecord('myco.com', 'up.railway.app')
    expect(seen).toBe(true)
  })

  it('returns false when there are no answers (not propagated yet)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ Answer: [] }) } as unknown as Response)
    const seen = await checkDnsRecord('myco.com', 'up.railway.app')
    expect(seen).toBe(false)
  })

  it('returns false (never throws) on network error', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValue(new Error('network'))
    const seen = await checkDnsRecord('myco.com', 'up.railway.app')
    expect(seen).toBe(false)
  })

  it('returns false for an empty domain without any fetch', async () => {
    const seen = await checkDnsRecord('', 'up.railway.app')
    expect(seen).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})
