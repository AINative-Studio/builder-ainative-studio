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
  auth: vi.fn(async () => null),
}))

vi.mock('next-auth/jwt', () => ({ getToken: h.getToken }))
vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/primitive-credentials', () => ({
  storeFounderCredential: h.storeFounderCredential,
  fetchOrganizationId: vi.fn(async () => undefined),
}))
// The route module pulls in every provisioning integration at import time —
// none of it is exercised by these tests (they call
// captureFounderCredentialForProxy directly, not POST), so stub them all out
// to keep this file's import graph light and hermetic.
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
vi.mock('@/lib/build/zeropipeline', () => ({ provisionPipeline: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/build/zerocommerce', () => ({ provisionStore: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/build/opencapstack', () => ({ provisionCapTable: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/build/zeroforms', () => ({ provisionForm: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/build/agentflow', () => ({ provisionProject: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/build/zeroerp', () => ({ provisionZeroERPTenant: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/build/mcp-provision', () => ({ provisionZeroDbViaMcp: vi.fn(async () => ({ ok: false })), isMcpProvisionEnabled: vi.fn(() => false) }))
vi.mock('@/lib/git/company-repo', () => ({ provisionCompanyRepo: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/build/ready-gate', () => ({ resolveStoredApp: vi.fn(async () => null) }))

import { captureFounderCredentialForProxy } from '@/app/api/build/provision/route'

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
