import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #449 — POST /api/build/growth/ad-test (explicit, founder-triggered
 * "create a test ad campaign" action).
 *
 * Properties under test:
 *  - disabled by default (GROWTH_AD_TESTING_ENABLED unset) — never calls
 *    any collaborator, always returns reason:'disabled';
 *  - disabled when the flag is on but no Marketing API credential is
 *    configured — a separate, honest failure mode;
 *  - requires a slug (400 on missing);
 *  - requires sign-in (reason:'signin' when anonymous);
 *  - is NOT gated on plan tier (#1017) — creation is PAUSED and spends
 *    nothing, so any signed-in founder can trigger it;
 *  - a signed-in founder on a company with no existing test campaign
 *    gets a real campaign created, and it's persisted via setAppGrowthAdTest;
 *  - a company that already has a test campaign short-circuits to the
 *    existing campaign WITHOUT calling createAdTestCampaign again;
 *  - a campaign-create failure is surfaced honestly, never fabricated as
 *    success;
 *  - the daily budget defaults and is capped at $25/day even if the client
 *    requests more.
 * All collaborators are mocked; no real network/Meta Ads call is made.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getPlanStatus: vi.fn(),
  resolveAppVerified: vi.fn(),
  setAppGrowthAdTest: vi.fn(async () => true),
  createAdTestCampaign: vi.fn(),
  growthAdTestingEnabled: vi.fn(() => true),
  growthAdTestingCredentialConfigured: vi.fn(() => true),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
// isPaidTier stays REAL so the route's actual paid-tier gate is exercised (#762).
vi.mock('@/lib/ainative/plan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ainative/plan')>()),
  getPlanStatus: h.getPlanStatus,
}))
vi.mock('@/lib/build/app-registry', () => ({
  resolveAppVerified: h.resolveAppVerified,
  setAppGrowthAdTest: h.setAppGrowthAdTest,
}))
vi.mock('@/lib/build/ad-testing', () => ({
  createAdTestCampaign: h.createAdTestCampaign,
  growthAdTestingEnabled: h.growthAdTestingEnabled,
  growthAdTestingCredentialConfigured: h.growthAdTestingCredentialConfigured,
  // #1017: the budget constants moved into lib/build/ad-testing.ts so the
  // auto-create path can share the DEFAULT. Mocked at their real values so
  // this route's existing clamping behavior is tested unchanged.
  DEFAULT_DAILY_BUDGET_USD: 5,
  MAX_DAILY_BUDGET_USD: 25,
}))

import { POST } from '@/app/api/build/growth/ad-test/route'

function postReq(body: unknown) {
  return { json: async () => body } as any
}

/** A confirmed resolveAppVerified() result — either a real entry or a confirmed miss. */
function verified(entry: Record<string, unknown> | null) {
  return { entry, verified: true }
}

const WITHOUT_CAMPAIGN = { slug: 'acme', chatId: 'c1', name: 'Acme', createdAt: '2026-08-01T00:00:00Z' }
const WITH_CAMPAIGN = { ...WITHOUT_CAMPAIGN, growthAdTestCampaignId: 'camp-existing' }

beforeEach(() => {
  vi.clearAllMocks()
  h.growthAdTestingEnabled.mockReturnValue(true)
  h.growthAdTestingCredentialConfigured.mockReturnValue(true)
  h.auth.mockResolvedValue({ accessToken: 'tok', user: { email: 'f@x.com' } })
  h.getPlanStatus.mockResolvedValue({ tier: 'pro' })
  h.resolveAppVerified.mockResolvedValue(verified(WITHOUT_CAMPAIGN))
  h.setAppGrowthAdTest.mockResolvedValue(true)
})

describe('POST /api/build/growth/ad-test (#449)', () => {
  it('is disabled by default — never calls any collaborator', async () => {
    h.growthAdTestingEnabled.mockReturnValue(false)
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual(expect.objectContaining({ ok: false, reason: 'disabled' }))
    expect(h.auth).not.toHaveBeenCalled()
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
  })

  it('is disabled when the flag is on but no Marketing API credential is configured', async () => {
    h.growthAdTestingCredentialConfigured.mockReturnValue(false)
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual(expect.objectContaining({ ok: false, reason: 'credential_not_configured' }))
    expect(h.auth).not.toHaveBeenCalled()
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
  })

  it('requires a slug', async () => {
    const res: any = await POST(postReq({}))
    expect(res.status).toBe(400)
  })

  it('requires sign-in', async () => {
    h.auth.mockResolvedValue(null)
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'signin' })
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
  })

  // ── #1017: campaign CREATION is not plan-gated ──────────────────────────────
  // This route creates the same PAUSED, zero-spend campaign, via the same
  // `createAdTestCampaign`, idempotent on the same registry field, as #1017's
  // auto-create path — which is deliberately ungated per the 2026-10-10
  // direction. A tier gate here only meant a free founder's AUTOMATIC campaign
  // succeeded while their own manual re-trigger of the identical operation
  // returned reason:'tier'.
  it('creates a campaign for a free-tier (hobbyist) founder — no tier gate (#1017)', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'hobbyist' })
    h.createAdTestCampaign.mockResolvedValue({ ok: true, campaignId: 'camp-free' })
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual({ ok: true, campaignId: 'camp-free' })
    expect(h.createAdTestCampaign).toHaveBeenCalledTimes(1)
  })

  it('creates a campaign even when the plan lookup itself errors (#1017)', async () => {
    // Creation costs nothing and spends nothing, so an unreachable core must
    // not block it. It never consults the plan at all now.
    h.getPlanStatus.mockRejectedValue(new Error('core unreachable'))
    h.createAdTestCampaign.mockResolvedValue({ ok: true, campaignId: 'camp-no-plan' })
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual({ ok: true, campaignId: 'camp-no-plan' })
  })

  it('never refuses creation with reason:"tier" for any plan (#1017)', async () => {
    h.createAdTestCampaign.mockResolvedValue({ ok: true, campaignId: 'camp-x' })
    for (const tier of ['hobbyist', 'starter', 'pro', 'enterprise', undefined]) {
      h.getPlanStatus.mockResolvedValue({ tier })
      const res: any = await POST(postReq({ slug: 'acme' }))
      const json = await res.json()
      expect(json.reason).not.toBe('tier')
      expect(json.ok).toBe(true)
    }
  })

  it('still requires sign-in — authentication is UNCHANGED (#1017)', async () => {
    h.auth.mockResolvedValue(null)
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'signin' })
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
  })

  it('404s when the company does not exist', async () => {
    h.resolveAppVerified.mockResolvedValue(verified(null))
    const res: any = await POST(postReq({ slug: 'nope' }))
    expect(res.status).toBe(404)
  })

  // #832-class bug: a transient registry-read failure must never be presented
  // as a confident "company not found" to a founder creating their ad campaign.
  it('503 lookup_failed when the registry read itself fails (NOT a false 404)', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(res.status).toBe(503)
    expect(json).toEqual({ ok: false, reason: 'lookup_failed' })
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
  })

  it('creates a real campaign for a paid, signed-in founder and persists it', async () => {
    h.createAdTestCampaign.mockResolvedValue({ ok: true, campaignId: 'camp-new' })
    const res: any = await POST(postReq({ slug: 'acme', dailyBudgetUsd: 15 }))
    const json = await res.json()
    expect(json).toEqual({ ok: true, campaignId: 'camp-new' })
    expect(h.createAdTestCampaign).toHaveBeenCalledWith({ companyName: 'Acme', tagline: undefined, dailyBudgetUsd: 15 })
    expect(h.setAppGrowthAdTest).toHaveBeenCalledWith('acme', { campaignId: 'camp-new' })
  })

  it('defaults dailyBudgetUsd to $5 when not provided', async () => {
    h.createAdTestCampaign.mockResolvedValue({ ok: true, campaignId: 'camp-new' })
    await POST(postReq({ slug: 'acme' }))
    expect(h.createAdTestCampaign).toHaveBeenCalledWith(expect.objectContaining({ dailyBudgetUsd: 5 }))
  })

  it('caps dailyBudgetUsd at $25 even if the client requests more', async () => {
    h.createAdTestCampaign.mockResolvedValue({ ok: true, campaignId: 'camp-new' })
    await POST(postReq({ slug: 'acme', dailyBudgetUsd: 500 }))
    expect(h.createAdTestCampaign).toHaveBeenCalledWith(expect.objectContaining({ dailyBudgetUsd: 25 }))
  })

  it('falls back to the slug when the company has no stored name', async () => {
    h.resolveAppVerified.mockResolvedValue(verified({ slug: 'acme', chatId: 'c1', createdAt: '2026-08-01T00:00:00Z' }))
    h.createAdTestCampaign.mockResolvedValue({ ok: true, campaignId: 'camp-new' })
    await POST(postReq({ slug: 'acme' }))
    expect(h.createAdTestCampaign).toHaveBeenCalledWith(expect.objectContaining({ companyName: 'acme' }))
  })

  it('short-circuits to the existing campaign for a company that already has one — never calls createAdTestCampaign again', async () => {
    h.resolveAppVerified.mockResolvedValue(verified(WITH_CAMPAIGN))
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual({ ok: true, campaignId: 'camp-existing' })
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
  })

  it('surfaces a real campaign-create failure honestly, never fabricates success', async () => {
    h.createAdTestCampaign.mockResolvedValue({ ok: false, reason: 'campaign_create_failed' })
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual(expect.objectContaining({ ok: false, reason: 'campaign_create_failed' }))
    expect(h.setAppGrowthAdTest).not.toHaveBeenCalled()
  })
})
