import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #243 — the PAID-ONLY deploy trigger in POST /api/build/subscription/verify.
 *
 * The overriding safety property: a dedicated (billable) Railway service is provisioned
 * ONLY after core confirms the Stripe session is PAID. We mock every collaborator so no
 * network/Railway call is real, and assert:
 *   - a NON-paid verify NEVER calls deployRailwayService (no cost on free/anon builds),
 *   - a PAID verify calls it exactly once, and persists the returned serviceId,
 *   - a PAID verify for an ALREADY-DEPLOYED company passes the existing serviceId
 *     through (idempotent — the client then short-circuits without creating a 2nd).
 */

// --- Mocks for all collaborators the route imports -------------------------------
// vi.mock factories are hoisted above imports, so the spies they reference must be
// created via vi.hoisted (also hoisted) to avoid a TDZ "before initialization" error.
const h = vi.hoisted(() => ({
  deployRailwayService: vi.fn(),
  railwayDeployEnabled: vi.fn(() => true),
  setAppRailwayService: vi.fn(async () => true),
  resolveApp: vi.fn(),
}))
const { deployRailwayService, railwayDeployEnabled, setAppRailwayService, resolveApp } = h

vi.mock('@/lib/build/deploy', () => ({
  deployRailwayService: h.deployRailwayService,
  railwayDeployEnabled: h.railwayDeployEnabled,
}))
vi.mock('@/lib/build/app-registry', () => ({
  setAppPlan: vi.fn(async () => true),
  claimCompanyProject: vi.fn(async () => ({ ok: true, claimed: false })),
  setAppOwner: vi.fn(async () => true),
  setAppRailwayService: h.setAppRailwayService,
  resolveApp: h.resolveApp,
}))
vi.mock('@/lib/build/learning', () => ({ markConverted: vi.fn(async () => {}) }))
vi.mock('@/lib/build/conversions', () => ({
  reportConversion: vi.fn(async () => {}),
  gclidFromRequest: vi.fn(() => null),
}))
vi.mock('@/lib/build/meta-capi', () => ({
  reportMetaConversion: vi.fn(async () => {}),
  fbcFromRequest: vi.fn(() => undefined),
  fbpFromRequest: vi.fn(() => undefined),
}))
vi.mock('@/lib/build/chat-store', () => ({
  deriveOwnerKey: vi.fn(() => 'guest:anon'),
}))
vi.mock('@/lib/build/referral', () => ({
  creditReferrerOnSubscribe: vi.fn(async () => 0),
}))
vi.mock('@/app/(auth)/auth', () => ({ auth: vi.fn(async () => null) }))

import { POST } from '@/app/api/build/subscription/verify/route'

function req(body: unknown) {
  return {
    json: async () => body,
    headers: { get: (_: string) => null },
  } as any
}

// The route calls core's pricing/verify via global fetch. Control paid vs not here.
function coreVerify(paid: boolean, plan = 'business') {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { paid, plan_id: paid ? plan : '', plan_name: paid ? 'Business' : '' } }),
  } as unknown as Response
}

describe('POST /api/build/subscription/verify — #243 deploy trigger', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    deployRailwayService.mockReset()
    railwayDeployEnabled.mockReset().mockReturnValue(true)
    setAppRailwayService.mockReset().mockResolvedValue(true)
    resolveApp.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does NOT deploy when the session is NOT paid', async () => {
    ;(fetch as any).mockResolvedValueOnce(coreVerify(false))
    const res = await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    const json = await res.json()
    expect(json.paid).toBe(false)
    expect(deployRailwayService).not.toHaveBeenCalled()
  })

  it('does NOT deploy when Railway deploy is disabled (cost-safe), even if paid', async () => {
    railwayDeployEnabled.mockReturnValue(false)
    ;(fetch as any).mockResolvedValue(coreVerify(true))
    resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1' })
    const res = await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    const json = await res.json()
    expect(json.paid).toBe(true)
    expect(deployRailwayService).not.toHaveBeenCalled()
  })

  it('deploys ONCE on a paid verify and persists the returned serviceId', async () => {
    ;(fetch as any).mockResolvedValue(coreVerify(true))
    resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', zerodbProjectId: 'z1' })
    deployRailwayService.mockResolvedValue({
      status: 'created',
      serviceId: 'svc-new',
      url: 'https://acme.up.railway.app',
      domain: 'acme.up.railway.app',
    })
    const res = await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    const json = await res.json()
    expect(json.paid).toBe(true)
    expect(json.deployed).toBe(true)
    expect(deployRailwayService).toHaveBeenCalledTimes(1)
    // The company's data layer is threaded through so the service serves real data.
    expect(deployRailwayService).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'acme', zerodbProjectId: 'z1' }),
    )
    expect(setAppRailwayService).toHaveBeenCalledWith(
      'acme',
      expect.objectContaining({ railwayServiceId: 'svc-new' }),
    )
  })

  it('is IDEMPOTENT — passes the existing serviceId through for an already-deployed company', async () => {
    ;(fetch as any).mockResolvedValue(coreVerify(true))
    resolveApp.mockResolvedValue({
      slug: 'acme',
      chatId: 'chat-1',
      zerodbProjectId: 'z1',
      railwayServiceId: 'svc-already',
      deployUrl: 'https://acme.up.railway.app',
    })
    deployRailwayService.mockResolvedValue({
      status: 'existing',
      serviceId: 'svc-already',
      url: 'https://acme.up.railway.app',
    })
    const res = await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    const json = await res.json()
    expect(json.deployed).toBe(true)
    expect(deployRailwayService).toHaveBeenCalledWith(
      expect.objectContaining({ existingServiceId: 'svc-already' }),
    )
    // status:'existing' means no NEW persist write is required.
    expect(setAppRailwayService).not.toHaveBeenCalled()
  })
})
