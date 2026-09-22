import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  railwayDeployEnabled,
  railwayApiConfigured,
  ensureCompanyService,
  findCompanyService,
  serviceNameForSlug,
  companyProjectId,
  listServiceVariables,
  listDeployments,
  redeployDeployment,
  redeployCurrent,
  upsertServiceVariable,
  deleteServiceVariable,
  createCustomDomain,
  getCustomDomainStatus,
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

/** Enabled + authenticated + scoped to a project, but NO shared source image/repo —
 *  this is EXACTLY production's shape (#835): companies are provisioned by
 *  deployCompanyFromGitea(), which needs no shared source, so neither
 *  RAILWAY_COMPANY_SOURCE_IMAGE nor _REPO is ever set. */
function enableRailwayWithoutSource() {
  vi.stubEnv('RAILWAY_DEPLOY_ENABLED', 'true')
  vi.stubEnv('RAILWAY_TOKEN', 'test-token')
  vi.stubEnv('RAILWAY_COMPANY_PROJECT_ID', 'proj-123')
  vi.stubEnv('RAILWAY_COMPANY_ENVIRONMENT_ID', 'env-123')
  vi.stubEnv('RAILWAY_COMPANY_SOURCE_IMAGE', '')
  vi.stubEnv('RAILWAY_COMPANY_SOURCE_REPO', '')
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
    // no SOURCE_IMAGE / SOURCE_REPO — nothing to create a service FROM, so the
    // creation gate stays shut. (#835: the API gate is separately true here; see
    // the '#835 — operational gate' block.)
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

/**
 * #835 — operational functions must NOT require the shared-source config.
 *
 * The production bug: every company provisioned by the current per-company path
 * (deployCompanyFromGitea) has a real railwayServiceId but there is no shared
 * source image/repo configured, so railwayDeployEnabled() was false and EVERY
 * operational call — secrets, domains, versions, redeploy — returned
 * reason:'disabled' for a genuinely provisioned company. Only service CREATION
 * needs a source; operating on an existing service does not.
 */
describe('#835 — operational gate does not require a shared source', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('railwayApiConfigured is TRUE with no image/repo (production shape)', () => {
    enableRailwayWithoutSource()
    expect(railwayApiConfigured()).toBe(true)
    // …while the CREATION gate stays false, because there is nothing to create from.
    expect(railwayDeployEnabled()).toBe(false)
  })

  it('railwayApiConfigured still requires the flag, a token and a project', () => {
    enableRailwayWithoutSource()
    vi.stubEnv('RAILWAY_DEPLOY_ENABLED', 'false')
    expect(railwayApiConfigured()).toBe(false)

    enableRailwayWithoutSource()
    vi.stubEnv('RAILWAY_TOKEN', '')
    vi.stubEnv('RAILWAY_API_TOKEN', '')
    expect(railwayApiConfigured()).toBe(false)
  })

  it('is false by default (no env at all) — still inert, still cost-safe', () => {
    expect(railwayApiConfigured()).toBe(false)
  })

  it('listServiceVariables REACHES Railway with no image/repo configured', async () => {
    enableRailwayWithoutSource()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(gql({ variables: { COMPANY_SLUG: 'triage', API_KEY: 'sk_x' } }))

    const res = await listServiceVariables('svc-existing')
    expect(res.ok).toBe(true)
    expect(res.reason).toBeUndefined()
    expect(res.variables).toEqual({ COMPANY_SLUG: 'triage', API_KEY: 'sk_x' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('listDeployments / redeployDeployment / redeployCurrent work with no source', async () => {
    enableRailwayWithoutSource()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(
      gql({
        deployments: { edges: [{ node: { id: 'dep-1', status: 'SUCCESS', createdAt: '2026-09-01T00:00:00Z', meta: {} } }] },
        deploymentRedeploy: { id: 'dep-2', status: 'BUILDING' },
      }),
    )

    const list = await listDeployments('svc-existing')
    expect(list.ok).toBe(true)
    expect(list.deployments?.[0]?.id).toBe('dep-1')

    const redeploy = await redeployDeployment('dep-1')
    expect(redeploy.ok).toBe(true)

    const current = await redeployCurrent('svc-existing')
    expect(current.ok).toBe(true)
    expect(current.fromDeploymentId).toBe('dep-1')
  })

  it('variable upsert/delete reach Railway with no source configured', async () => {
    enableRailwayWithoutSource()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(gql({ variableUpsert: true, variableDelete: true }))

    expect(await upsertServiceVariable('svc-existing', 'STRIPE_KEY', 'sk_live_x')).toEqual({ ok: true })
    expect(await deleteServiceVariable('svc-existing', 'STRIPE_KEY')).toEqual({ ok: true })
  })

  it('custom-domain create/status work with no source configured (#53)', async () => {
    enableRailwayWithoutSource()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      gql({ customDomainCreate: { id: 'cd-1', domain: 'myco.com', status: 'WAITING', dnsRecords: [] } }),
    )
    const created = await createCustomDomain('svc-existing', 'myco.com')
    expect(created.ok).toBe(true)
    expect(created.id).toBe('cd-1')

    fetchMock.mockResolvedValueOnce(
      gql({ domains: { customDomains: [{ id: 'cd-1', domain: 'myco.com', status: 'ACTIVE', certificateStatus: 'ISSUED', dnsRecords: [] }] } }),
    )
    const status = await getCustomDomainStatus('svc-existing', 'myco.com')
    expect(status.ok).toBe(true)
    expect(status.status).toBe('live')
  })

  it('ensureCompanyService ALONE still requires a source — no billable create without one', async () => {
    enableRailwayWithoutSource()
    const res = await ensureCompanyService('acme', 'zpid-1')
    expect(res).toEqual({ ok: false, reason: 'disabled' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('an UNPROVISIONED company still fails honestly — no false "available"', async () => {
    enableRailwayWithoutSource()
    // Empty serviceId: the company has no dedicated service. Must be a real
    // no_service reason with NO Railway call — never a misleading ok:true.
    expect(await listServiceVariables('')).toEqual({ ok: false, reason: 'no_service' })
    expect(await listDeployments('')).toEqual({ ok: false, reason: 'no_service' })
    expect(await redeployCurrent('')).toEqual({ ok: false, reason: 'no_service' })
    expect(await upsertServiceVariable('', 'API_KEY', 'v')).toEqual({ ok: false, reason: 'no_service' })
    expect(await deleteServiceVariable('', 'API_KEY')).toEqual({ ok: false, reason: 'no_service' })
    expect(await createCustomDomain('', 'myco.com')).toEqual({ ok: false, reason: 'no_service' })
    expect(await getCustomDomainStatus('', 'myco.com')).toEqual({ ok: false, reason: 'no_service' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

/**
 * #835 — the environment id the operational calls need. RAILWAY_COMPANY_ENVIRONMENT_ID
 * is not set in production, so without a fallback every call would fail
 * 'no_environment' even once the gate is fixed. Builder runs INSIDE the company
 * project, so Railway's own injected RAILWAY_ENVIRONMENT_ID is that project's
 * production environment — but only when builder's project IS the company project.
 */
describe('#835 — company environment id resolution', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("falls back to builder's own env id when it runs in the company project", async () => {
    vi.stubEnv('RAILWAY_DEPLOY_ENABLED', 'true')
    vi.stubEnv('RAILWAY_TOKEN', 'test-token')
    vi.stubEnv('RAILWAY_COMPANY_PROJECT_ID', 'proj-123')
    vi.stubEnv('RAILWAY_COMPANY_ENVIRONMENT_ID', '') // production's real shape
    vi.stubEnv('RAILWAY_PROJECT_ID', 'proj-123')     // builder runs in that same project
    vi.stubEnv('RAILWAY_ENVIRONMENT_ID', 'env-prod')

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(gql({ variables: { COMPANY_SLUG: 'triage' } }))

    const res = await listServiceVariables('svc-existing')
    expect(res.ok).toBe(true)
    // The derived env id is what actually went to Railway.
    const body = String(fetchMock.mock.calls[0]?.[1]?.body || '')
    expect(body).toContain('env-prod')
  })

  it('an explicit RAILWAY_COMPANY_ENVIRONMENT_ID still wins', async () => {
    vi.stubEnv('RAILWAY_DEPLOY_ENABLED', 'true')
    vi.stubEnv('RAILWAY_TOKEN', 'test-token')
    vi.stubEnv('RAILWAY_COMPANY_PROJECT_ID', 'proj-123')
    vi.stubEnv('RAILWAY_COMPANY_ENVIRONMENT_ID', 'env-explicit')
    vi.stubEnv('RAILWAY_PROJECT_ID', 'proj-123')
    vi.stubEnv('RAILWAY_ENVIRONMENT_ID', 'env-prod')

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(gql({ variables: {} }))
    await listServiceVariables('svc-existing')
    const body = String(fetchMock.mock.calls[0]?.[1]?.body || '')
    expect(body).toContain('env-explicit')
    expect(body).not.toContain('env-prod')
  })

  it('does NOT borrow an env id from a DIFFERENT project', async () => {
    vi.stubEnv('RAILWAY_DEPLOY_ENABLED', 'true')
    vi.stubEnv('RAILWAY_TOKEN', 'test-token')
    vi.stubEnv('RAILWAY_COMPANY_PROJECT_ID', 'proj-companies')
    vi.stubEnv('RAILWAY_COMPANY_ENVIRONMENT_ID', '')
    vi.stubEnv('RAILWAY_PROJECT_ID', 'proj-somewhere-else')
    vi.stubEnv('RAILWAY_ENVIRONMENT_ID', 'env-unrelated')

    const res = await listServiceVariables('svc-existing')
    expect(res).toEqual({ ok: false, reason: 'no_environment' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('stays empty off-Railway (local/test) — inert, unchanged behaviour', async () => {
    vi.stubEnv('RAILWAY_DEPLOY_ENABLED', 'true')
    vi.stubEnv('RAILWAY_TOKEN', 'test-token')
    vi.stubEnv('RAILWAY_COMPANY_PROJECT_ID', 'proj-123')
    vi.stubEnv('RAILWAY_COMPANY_ENVIRONMENT_ID', '')
    vi.stubEnv('RAILWAY_PROJECT_ID', '')
    vi.stubEnv('RAILWAY_ENVIRONMENT_ID', '')

    const res = await listServiceVariables('svc-existing')
    expect(res).toEqual({ ok: false, reason: 'no_environment' })
    expect(fetch).not.toHaveBeenCalled()
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
