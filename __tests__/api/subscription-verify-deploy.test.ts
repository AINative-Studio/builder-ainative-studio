import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #243/#389 — the PAID-ONLY deploy trigger in POST /api/build/subscription/verify.
 *
 * #389 rewired this from the old shared-image GraphQL flow (deployRailwayService,
 * which never worked for any real company — confirmed 0/67 companies in the
 * registry ever got a railwayServiceId, since RAILWAY_COMPANY_SOURCE_IMAGE/_REPO
 * were never configured) to the REAL mechanism (#381): deployCompanyFromGitea,
 * which fetches the company's own Gitea repo content and deploys it via
 * `railway add` + `railway up`.
 *
 * The overriding safety property is unchanged: a dedicated (billable) Railway
 * service is provisioned ONLY after core confirms the Stripe session is PAID. We
 * mock every collaborator so no network/Railway call is real, and assert:
 *   - a NON-paid verify NEVER calls deployCompanyFromGitea (no cost on free/anon builds),
 *   - deploy is skipped when RAILWAY_DEPLOY_ENABLED is off (companyDeployEnabled() false),
 *   - a PAID verify calls it exactly once and persists the returned serviceName,
 *   - a PAID verify for an ALREADY-DEPLOYED company passes alreadyProvisioned=true
 *     through (idempotent — redeploys current content, never a 2nd service),
 *   - a company with no Gitea repo yet ({ok:false, reason:'no_repo'}) is a normal,
 *     non-error skip — checkout confirmation still succeeds, deployed stays undefined.
 */

// --- Mocks for all collaborators the route imports -------------------------------
// vi.mock factories are hoisted above imports, so the spies they reference must be
// created via vi.hoisted (also hoisted) to avoid a TDZ "before initialization" error.
const h = vi.hoisted(() => ({
  deployCompanyFromGitea: vi.fn(),
  companyDeployEnabled: vi.fn(() => true),
  setAppRailwayService: vi.fn(async () => true),
  resolveApp: vi.fn(),
}))
const { deployCompanyFromGitea, companyDeployEnabled, setAppRailwayService, resolveApp } = h

vi.mock('@/lib/build/company-deploy', () => ({
  deployCompanyFromGitea: h.deployCompanyFromGitea,
  companyDeployEnabled: h.companyDeployEnabled,
}))
vi.mock('@/lib/build/instant-db', () => ({
  BUILDER_WORKSPACE_ID: '5d2376e1-d4f0-4193-9a7f-84e4543a8f9a',
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

describe('POST /api/build/subscription/verify — #389 real deploy trigger', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    deployCompanyFromGitea.mockReset()
    companyDeployEnabled.mockReset().mockReturnValue(true)
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
    expect(deployCompanyFromGitea).not.toHaveBeenCalled()
  })

  it('does NOT deploy when Railway deploy is disabled (cost-safe), even if paid', async () => {
    companyDeployEnabled.mockReturnValue(false)
    ;(fetch as any).mockResolvedValue(coreVerify(true))
    resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1' })
    const res = await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    const json = await res.json()
    expect(json.paid).toBe(true)
    expect(deployCompanyFromGitea).not.toHaveBeenCalled()
  })

  it('deploys ONCE on a paid verify and persists the returned serviceName', async () => {
    ;(fetch as any).mockResolvedValue(coreVerify(true))
    resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', workspaceId: 'ws-1' })
    deployCompanyFromGitea.mockResolvedValue({
      ok: true,
      serviceName: 'company-acme',
      url: 'https://company-acme-production.up.railway.app',
    })
    const res = await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    const json = await res.json()
    expect(json.paid).toBe(true)
    expect(json.deployed).toBe(true)
    expect(deployCompanyFromGitea).toHaveBeenCalledTimes(1)
    expect(deployCompanyFromGitea).toHaveBeenCalledWith('ws-1', 'acme', false)
    expect(setAppRailwayService).toHaveBeenCalledWith(
      'acme',
      expect.objectContaining({
        railwayServiceId: 'company-acme',
        deployUrl: 'https://company-acme-production.up.railway.app',
      }),
    )
  })

  it('falls back to BUILDER_WORKSPACE_ID when the company has no persisted workspaceId', async () => {
    ;(fetch as any).mockResolvedValue(coreVerify(true))
    resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1' })
    deployCompanyFromGitea.mockResolvedValue({ ok: true, serviceName: 'company-acme' })
    await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    expect(deployCompanyFromGitea).toHaveBeenCalledWith('5d2376e1-d4f0-4193-9a7f-84e4543a8f9a', 'acme', false)
  })

  it('is IDEMPOTENT — passes alreadyProvisioned=true for an already-deployed company (redeploy, not a 2nd service)', async () => {
    ;(fetch as any).mockResolvedValue(coreVerify(true))
    resolveApp.mockResolvedValue({
      slug: 'acme',
      chatId: 'chat-1',
      workspaceId: 'ws-1',
      railwayServiceId: 'company-acme',
      deployUrl: 'https://company-acme-production.up.railway.app',
    })
    deployCompanyFromGitea.mockResolvedValue({
      ok: true,
      serviceName: 'company-acme',
      url: 'https://company-acme-production.up.railway.app',
    })
    const res = await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    const json = await res.json()
    expect(json.deployed).toBe(true)
    expect(deployCompanyFromGitea).toHaveBeenCalledWith('ws-1', 'acme', true)
  })

  it('is a normal, non-error SKIP when the company has no Gitea repo yet — checkout still succeeds', async () => {
    ;(fetch as any).mockResolvedValue(coreVerify(true))
    resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', workspaceId: 'ws-1' })
    deployCompanyFromGitea.mockResolvedValue({ ok: false, reason: 'no_repo' })
    const res = await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.paid).toBe(true)
    expect(json.deployed).toBeUndefined()
    expect(setAppRailwayService).not.toHaveBeenCalled()
  })

  it('NEVER fails checkout confirmation when deployCompanyFromGitea throws', async () => {
    ;(fetch as any).mockResolvedValue(coreVerify(true))
    resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', workspaceId: 'ws-1' })
    deployCompanyFromGitea.mockRejectedValue(new Error('railway CLI unavailable'))
    const res = await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.paid).toBe(true)
    expect(json.deployed).toBeUndefined()
  })

  it('skips the deploy attempt entirely when the company has no chatId yet (never fully created)', async () => {
    ;(fetch as any).mockResolvedValue(coreVerify(true))
    resolveApp.mockResolvedValue({ slug: 'acme' })
    const res = await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    const json = await res.json()
    expect(json.paid).toBe(true)
    expect(deployCompanyFromGitea).not.toHaveBeenCalled()
  })
})
