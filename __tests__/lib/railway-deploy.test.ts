import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  railwayDeployEnabled,
  ensureCompanyService,
  findCompanyService,
  serviceNameForSlug,
  companyProjectId,
} from '@/lib/build/railway-deploy'
import { deployRailwayService } from '@/lib/build/deploy'

/**
 * #243 — per-company Railway service provisioner + deploy orchestration.
 *
 * The overriding safety property under test: a dedicated (billable) Railway service
 * is created ONLY when explicitly enabled + configured, and NEVER twice for the same
 * company. We mock global fetch so NO real Railway API call is ever made, and assert
 * the cost guards short-circuit before any fetch.
 */
function gql(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data }),
  } as unknown as Response
}

// A fully-configured, enabled Railway env (image source).
function enableRailway() {
  vi.stubEnv('RAILWAY_DEPLOY_ENABLED', 'true')
  vi.stubEnv('RAILWAY_TOKEN', 'test-token')
  vi.stubEnv('RAILWAY_COMPANY_PROJECT_ID', 'proj-123')
  vi.stubEnv('RAILWAY_COMPANY_ENVIRONMENT_ID', 'env-123')
  vi.stubEnv('RAILWAY_COMPANY_SOURCE_IMAGE', 'ghcr.io/ainative/company-runtime:latest')
}

describe('railwayDeployEnabled — cost gate', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('is false by default (no env) — inert, cost-safe', () => {
    expect(railwayDeployEnabled()).toBe(false)
  })

  it('is false when the flag is off even if everything else is set', () => {
    enableRailway()
    vi.stubEnv('RAILWAY_DEPLOY_ENABLED', 'false')
    expect(railwayDeployEnabled()).toBe(false)
  })

  it('is false when the flag is on but no token', () => {
    enableRailway()
    vi.stubEnv('RAILWAY_TOKEN', '')
    vi.stubEnv('RAILWAY_API_TOKEN', '')
    expect(railwayDeployEnabled()).toBe(false)
  })

  it('is false when enabled+token but NO source (image/repo) configured', () => {
    vi.stubEnv('RAILWAY_DEPLOY_ENABLED', 'true')
    vi.stubEnv('RAILWAY_TOKEN', 'test-token')
    vi.stubEnv('RAILWAY_COMPANY_PROJECT_ID', 'proj-123')
    // no SOURCE_IMAGE / SOURCE_REPO
    expect(railwayDeployEnabled()).toBe(false)
  })

  it('is true only when flag + token + project + source are all present', () => {
    enableRailway()
    expect(railwayDeployEnabled()).toBe(true)
  })

  it('defaults the company project to AINative Studio - Production', () => {
    vi.unstubAllEnvs()
    expect(companyProjectId()).toBe('47539617-ae34-4a52-a010-a88d875f347e')
  })
})

describe('ensureCompanyService — never touches Railway when disabled', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns { ok:false, reason:disabled } WITHOUT any fetch when disabled', async () => {
    const res = await ensureCompanyService('acme', 'zpid-1')
    expect(res).toEqual({ ok: false, reason: 'disabled' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reuses an existing same-named service instead of creating a second one', async () => {
    enableRailway()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    // findCompanyService → project.services returns a service already named for slug.
    fetchMock.mockResolvedValueOnce(
      gql({ project: { services: { edges: [{ node: { id: 'svc-existing', name: serviceNameForSlug('acme') } }] } } }),
    )
    // createServiceDomain → no existing domain, then create returns one.
    fetchMock.mockResolvedValueOnce(gql({ domains: { serviceDomains: [] } }))
    fetchMock.mockResolvedValueOnce(gql({ serviceDomainCreate: { domain: 'acme-prod.up.railway.app' } }))

    const res = await ensureCompanyService('acme', 'zpid-1')
    expect(res.ok).toBe(true)
    expect(res.serviceId).toBe('svc-existing')
    expect(res.url).toBe('https://acme-prod.up.railway.app')
    // Crucially: no serviceCreate mutation was ever sent (we reused).
    const bodies = fetchMock.mock.calls.map((c: any[]) => String(c[1]?.body || ''))
    expect(bodies.some((b: string) => b.includes('serviceCreate'))).toBe(false)
  })

  it('creates a new service (serviceCreate) when none exists, then a domain', async () => {
    enableRailway()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    // findCompanyService → no match
    fetchMock.mockResolvedValueOnce(gql({ project: { services: { edges: [] } } }))
    // serviceCreate → new id
    fetchMock.mockResolvedValueOnce(gql({ serviceCreate: { id: 'svc-new', name: serviceNameForSlug('acme') } }))
    // domain: none existing, then create
    fetchMock.mockResolvedValueOnce(gql({ domains: { serviceDomains: [] } }))
    fetchMock.mockResolvedValueOnce(gql({ serviceDomainCreate: { domain: 'acme-x.up.railway.app' } }))

    const res = await ensureCompanyService('acme', 'zpid-1')
    expect(res.ok).toBe(true)
    expect(res.serviceId).toBe('svc-new')
    expect(res.url).toBe('https://acme-x.up.railway.app')
    const bodies = fetchMock.mock.calls.map((c: any[]) => String(c[1]?.body || ''))
    // The company's data layer + slug are injected as service variables.
    expect(bodies.some((b: string) => b.includes('serviceCreate') && b.includes('zpid-1'))).toBe(true)
  })

  it('findCompanyService returns null (no throw) when disabled', async () => {
    const id = await findCompanyService('acme')
    expect(id).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('deployRailwayService — orchestration + idempotency', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('SKIPS (no cost, no fetch) when Railway deploy is not enabled', async () => {
    const res = await deployRailwayService({ slug: 'acme', zerodbProjectId: 'z1' })
    expect(res.status).toBe('skipped')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('is IDEMPOTENT — existingServiceId short-circuits with no fetch (no 2nd service)', async () => {
    enableRailway() // even when enabled, an existing service must not be recreated
    const res = await deployRailwayService({
      slug: 'acme',
      existingServiceId: 'svc-already',
      existingUrl: 'https://acme.up.railway.app',
    })
    expect(res.status).toBe('existing')
    expect(res.serviceId).toBe('svc-already')
    expect(res.url).toBe('https://acme.up.railway.app')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('CREATES a service when enabled and none exists yet', async () => {
    enableRailway()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(gql({ project: { services: { edges: [] } } }))
    fetchMock.mockResolvedValueOnce(gql({ serviceCreate: { id: 'svc-fresh', name: serviceNameForSlug('acme') } }))
    fetchMock.mockResolvedValueOnce(gql({ domains: { serviceDomains: [] } }))
    fetchMock.mockResolvedValueOnce(gql({ serviceDomainCreate: { domain: 'acme.up.railway.app' } }))

    const res = await deployRailwayService({ slug: 'acme', zerodbProjectId: 'z1' })
    expect(res.status).toBe('created')
    expect(res.serviceId).toBe('svc-fresh')
    expect(res.url).toBe('https://acme.up.railway.app')
  })

  it('rejects a bad/empty slug without any fetch', async () => {
    const res = await deployRailwayService({ slug: '' })
    expect(res.status).toBe('error')
    expect(fetch).not.toHaveBeenCalled()
  })
})
