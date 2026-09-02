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
 *  - requires a PAID tier (reason:'tier' for hobbyist/free);
 *  - a paid, signed-in founder on a company with no existing test campaign
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
  resolveApp: vi.fn(),
  setAppGrowthAdTest: vi.fn(async () => true),
  createAdTestCampaign: vi.fn(),
  growthAdTestingEnabled: vi.fn(() => true),
  growthAdTestingCredentialConfigured: vi.fn(() => true),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/ainative/plan', () => ({ getPlanStatus: h.getPlanStatus }))
vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: h.resolveApp,
  setAppGrowthAdTest: h.setAppGrowthAdTest,
}))
vi.mock('@/lib/build/ad-testing', () => ({
  createAdTestCampaign: h.createAdTestCampaign,
  growthAdTestingEnabled: h.growthAdTestingEnabled,
  growthAdTestingCredentialConfigured: h.growthAdTestingCredentialConfigured,
}))

import { POST } from '@/app/api/build/growth/ad-test/route'

function postReq(body: unknown) {
  return { json: async () => body } as any
}

const WITHOUT_CAMPAIGN = { slug: 'acme', chatId: 'c1', name: 'Acme', createdAt: '2026-08-01T00:00:00Z' }
const WITH_CAMPAIGN = { ...WITHOUT_CAMPAIGN, growthAdTestCampaignId: 'camp-existing' }

beforeEach(() => {
  vi.clearAllMocks()
  h.growthAdTestingEnabled.mockReturnValue(true)
  h.growthAdTestingCredentialConfigured.mockReturnValue(true)
  h.auth.mockResolvedValue({ accessToken: 'tok', user: { email: 'f@x.com' } })
  h.getPlanStatus.mockResolvedValue({ tier: 'pro' })
  h.resolveApp.mockResolvedValue(WITHOUT_CAMPAIGN)
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

  it('blocks a non-paid (hobbyist) tier', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'hobbyist' })
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'tier', tier: 'hobbyist' })
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
  })

  it('fails closed to the un-paid default when plan lookup itself errors', async () => {
    h.getPlanStatus.mockRejectedValue(new Error('core unreachable'))
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.reason).toBe('tier')
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
  })

  it('404s when the company does not exist', async () => {
    h.resolveApp.mockResolvedValue(null)
    const res: any = await POST(postReq({ slug: 'nope' }))
    expect(res.status).toBe(404)
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
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'c1', createdAt: '2026-08-01T00:00:00Z' })
    h.createAdTestCampaign.mockResolvedValue({ ok: true, campaignId: 'camp-new' })
    await POST(postReq({ slug: 'acme' }))
    expect(h.createAdTestCampaign).toHaveBeenCalledWith(expect.objectContaining({ companyName: 'acme' }))
  })

  it('short-circuits to the existing campaign for a company that already has one — never calls createAdTestCampaign again', async () => {
    h.resolveApp.mockResolvedValue(WITH_CAMPAIGN)
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
