import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * captureFounderCredentialForProxy (app/api/build/provision/route.ts) — real
 * bug found live (triage, 2026-09-11), traced via the pipelineCredentialCaptured
 * diagnostic added for this exact investigation: this function used to treat
 * getToken() returning null as a hard failure and bail out entirely —
 * `if (!rawToken?.refreshToken && !rawToken?.accessToken) return false` —
 * even though `jwt` (the caller's already-resolved session.accessToken from
 * auth()) is the only credential this function actually needs to store.
 * Confirmed live: getToken() returned null for every real provision request
 * tested, so captureFounderCredentialForProxy always returned false and
 * builder_primitive_credentials never got a row for zeropipeline (or
 * zeroinvoice/serviceos/livestreaming/socialgraph, all of which share this
 * same helper) — despite provisionPipeline itself succeeding
 * (pipelineProvisioned:true) and the real ZeroDB write path itself working
 * fine when tested directly.
 *
 * zerocrm's sibling block (a separate, standalone call a few lines below in
 * provision/route.ts) never had this bug, because it only reads getToken()'s
 * result as an OPTIONAL source for a refresh token — it never gates on
 * getToken() succeeding at all.
 */

const h = vi.hoisted(() => ({
  getToken: vi.fn<(...args: any[]) => Promise<any>>(),
  storeFounderCredential: vi.fn(async (..._args: any[]) => true),
  hasFounderCredential: vi.fn<(...args: any[]) => Promise<boolean>>(),
  fetchOrganizationId: vi.fn<(...args: any[]) => Promise<string | undefined>>(),
  auth: vi.fn(async () => null),
  provisionPipeline: vi.fn<(...args: any[]) => Promise<any>>(),
  provisionStore: vi.fn<(...args: any[]) => Promise<any>>(),
  provisionForm: vi.fn<(...args: any[]) => Promise<any>>(),
  provisionProject: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('next-auth/jwt', () => ({ getToken: h.getToken }))
vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/primitive-credentials', () => ({
  storeFounderCredential: h.storeFounderCredential,
  fetchOrganizationId: h.fetchOrganizationId,
  hasFounderCredential: h.hasFounderCredential,
}))
// The route module pulls in every provisioning integration at import time —
// none of it is exercised by most of these tests (they call
// captureFounderCredentialForProxy directly, not POST), so stub them all out
// to keep this file's import graph light and hermetic. The four re-exposed
// as controllable mocks (h.provision*) back backfillMissingCredentials's own
// tests further below.
vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: vi.fn(async () => null), setAppProvisioned: vi.fn(async () => true), setAppOwner: vi.fn(async () => true),
}))
vi.mock('@/lib/build/deploy', () => ({ deployPersistent: vi.fn(async () => ({ url: '', dnsPointable: false })) }))
vi.mock('@/lib/build/instant-db', () => ({
  provisionInstantDb: vi.fn(async () => ({ ok: false })),
  fileProjectUnderBuilderWorkspace: vi.fn(async () => ({ filed: false })),
  BUILDER_WORKSPACE_ID: 'test-workspace',
  TRIAL_WINDOW_MS: 72 * 60 * 60 * 1000,
}))
vi.mock('@/lib/build/zeropipeline', () => ({ provisionPipeline: h.provisionPipeline }))
vi.mock('@/lib/build/zerocommerce', () => ({ provisionStore: h.provisionStore }))
vi.mock('@/lib/build/opencapstack', () => ({ provisionCapTable: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/build/zeroforms', () => ({ provisionForm: h.provisionForm }))
vi.mock('@/lib/build/agentflow', () => ({ provisionProject: h.provisionProject }))
vi.mock('@/lib/build/zeroerp', () => ({ provisionZeroERPTenant: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/build/mcp-provision', () => ({ provisionZeroDbViaMcp: vi.fn(async () => ({ ok: false })), isMcpProvisionEnabled: vi.fn(() => false) }))
vi.mock('@/lib/git/company-repo', () => ({ provisionCompanyRepo: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/build/ready-gate', () => ({ resolveStoredApp: vi.fn(async () => null) }))

import { captureFounderCredentialForProxy, backfillMissingCredentials } from '@/app/api/build/provision/route'

function fakeRequest(): any {
  return { headers: new Headers(), cookies: { get: () => undefined } }
}

describe('captureFounderCredentialForProxy', () => {
  beforeEach(() => {
    h.getToken.mockReset()
    h.storeFounderCredential.mockReset().mockResolvedValue(true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('still stores the credential using the already-resolved jwt when getToken returns null (the real triage regression)', async () => {
    h.getToken.mockResolvedValue(null)

    const result = await captureFounderCredentialForProxy(fakeRequest(), 'triage', 'zeropipeline', 'real-jwt-access-token')

    expect(result).toBe(true)
    expect(h.storeFounderCredential).toHaveBeenCalledWith(
      'triage',
      'zeropipeline',
      'real-jwt-access-token',
      undefined,
      undefined,
    )
  })

  it('still stores the credential when getToken throws entirely', async () => {
    h.getToken.mockRejectedValue(new Error('decode failed'))

    const result = await captureFounderCredentialForProxy(fakeRequest(), 'triage', 'zeropipeline', 'real-jwt-access-token')

    expect(result).toBe(true)
    expect(h.storeFounderCredential).toHaveBeenCalledWith(
      'triage',
      'zeropipeline',
      'real-jwt-access-token',
      undefined,
      undefined,
    )
  })

  it('opportunistically includes the refresh token and computed expiry when getToken DOES succeed', async () => {
    const futureExpiry = Date.now() + 3600_000
    h.getToken.mockResolvedValue({ accessToken: 'raw-access', refreshToken: 'real-refresh-token', expiresAt: futureExpiry })

    await captureFounderCredentialForProxy(fakeRequest(), 'acme', 'zerocommerce', 'real-jwt-access-token')

    const call = h.storeFounderCredential.mock.calls[0]
    expect(call[0]).toBe('acme')
    expect(call[1]).toBe('zerocommerce')
    expect(call[2]).toBe('real-jwt-access-token')
    expect(call[3]).toBe('real-refresh-token')
    expect(call[4]).toBeGreaterThan(0)
    expect(call[4]).toBeLessThanOrEqual(3600)
  })

  it('returns false when storeFounderCredential itself fails, even though getToken succeeded', async () => {
    h.getToken.mockResolvedValue({ accessToken: 'raw-access' })
    h.storeFounderCredential.mockResolvedValue(false)

    const result = await captureFounderCredentialForProxy(fakeRequest(), 'triage', 'zeropipeline', 'real-jwt-access-token')

    expect(result).toBe(false)
  })

  it('returns false (never throws) when storeFounderCredential itself throws', async () => {
    h.getToken.mockResolvedValue(null)
    h.storeFounderCredential.mockRejectedValue(new Error('zerodb down'))

    const result = await captureFounderCredentialForProxy(fakeRequest(), 'triage', 'zeropipeline', 'real-jwt-access-token')

    expect(result).toBe(false)
  })
})

/**
 * backfillMissingCredentials — the north-star gap this whole investigation
 * was about: fixing captureFounderCredentialForProxy's getToken bug (#664)
 * does NOT repair a company that was already provisioned before the fix
 * shipped. Confirmed live (dispatch, provisioned before #664): its
 * zerodbProjectId already being set means every subsequent /api/build/provision
 * call takes the idempotent-return path, which never re-attempts credential
 * capture — so the underlying bug being fixed changes nothing for a company
 * already broken by it. This backfill re-attempts ONLY the primitives
 * genuinely missing a credential, on every idempotent hit.
 */
describe('backfillMissingCredentials', () => {
  beforeEach(() => {
    h.getToken.mockReset().mockResolvedValue(null)
    h.storeFounderCredential.mockReset().mockResolvedValue(true)
    h.hasFounderCredential.mockReset().mockResolvedValue(false)
    h.fetchOrganizationId.mockReset().mockResolvedValue('org-123')
    h.provisionPipeline.mockReset().mockResolvedValue({ ok: true, pipelineId: 'pipe-1' })
    h.provisionStore.mockReset().mockResolvedValue({ ok: true, storeId: 'store-1' })
    h.provisionForm.mockReset().mockResolvedValue({ ok: true, formId: 'form-1' })
    h.provisionProject.mockReset().mockResolvedValue({ ok: true, projectId: 'proj-1' })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is a no-op when no jwt is present (anonymous request)', async () => {
    await backfillMissingCredentials(fakeRequest(), 'dispatch', 'Dispatch', undefined)

    expect(h.provisionPipeline).not.toHaveBeenCalled()
    expect(h.storeFounderCredential).not.toHaveBeenCalled()
  })

  it('re-attempts zeropipeline when its credential is missing (the real dispatch regression)', async () => {
    h.hasFounderCredential.mockImplementation(async (_slug: string, primitive: string) => primitive !== 'zeropipeline')

    await backfillMissingCredentials(fakeRequest(), 'dispatch', 'Dispatch', 'real-jwt')

    expect(h.provisionPipeline).toHaveBeenCalledWith('real-jwt', 'dispatch', 'Dispatch')
    expect(h.storeFounderCredential).toHaveBeenCalledWith(
      'dispatch', 'zeropipeline', 'real-jwt', undefined, undefined,
    )
  })

  it('skips every primitive that already has a credential — never re-provisions unnecessarily', async () => {
    h.hasFounderCredential.mockResolvedValue(true)

    await backfillMissingCredentials(fakeRequest(), 'dispatch', 'Dispatch', 'real-jwt')

    expect(h.provisionPipeline).not.toHaveBeenCalled()
    expect(h.provisionStore).not.toHaveBeenCalled()
    expect(h.provisionForm).not.toHaveBeenCalled()
    expect(h.provisionProject).not.toHaveBeenCalled()
    expect(h.storeFounderCredential).not.toHaveBeenCalled()
  })

  it('repairs all five credential-only primitives (zerocrm, zeroinvoice, serviceos, livestreaming, socialgraph) in one pass when all are missing', async () => {
    h.hasFounderCredential.mockResolvedValue(false)

    await backfillMissingCredentials(fakeRequest(), 'aerosol', 'Aerosol', 'real-jwt')

    // zerocrm goes through storeFounderCredential directly (org-scoped);
    // the other four go through captureFounderCredentialForProxy, which
    // also calls storeFounderCredential — so at minimum 5 real store calls,
    // one per primitive, none skipped.
    const primitivesStored = h.storeFounderCredential.mock.calls.map((c) => c[1])
    for (const p of ['zerocrm', 'zeroinvoice', 'serviceos', 'livestreaming', 'socialgraph']) {
      expect(primitivesStored).toContain(p)
    }
  })

  it('does not store a zerocrm credential when the organization id cannot be resolved', async () => {
    h.hasFounderCredential.mockImplementation(async (_slug: string, primitive: string) => primitive !== 'zerocrm')
    h.fetchOrganizationId.mockResolvedValue(undefined)

    await backfillMissingCredentials(fakeRequest(), 'dispatch', 'Dispatch', 'real-jwt')

    expect(h.storeFounderCredential).not.toHaveBeenCalledWith(
      expect.anything(), 'zerocrm', expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    )
  })

  it('never throws when a hasFounderCredential check itself fails (fails toward re-attempting, not toward silently skipping)', async () => {
    h.hasFounderCredential.mockRejectedValue(new Error('zerodb read failed'))

    await expect(
      backfillMissingCredentials(fakeRequest(), 'dispatch', 'Dispatch', 'real-jwt'),
    ).resolves.toBeUndefined()
  })
})
