import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * lib/build/ad-test-autocreate (#1017) — auto-create a real, PAUSED Meta
 * ad-test campaign the moment a founder's build is genuinely complete, with no
 * founder input and NO PLAN-TIER GATE (confirmed product direction,
 * 2026-10-10: ad validation is explicitly available to any founder including
 * free tier; the real gate for *activation* is prepaid credits purchased, and
 * that gate lives in the ad-budget-confirmed webhook, not here).
 *
 * Properties under test:
 *  - fires with the company's REAL stored name/tagline from the registry;
 *  - never consults plan tier / getPlanStatus at all;
 *  - still honours the feature flag + credential guards (fails closed, quietly);
 *  - idempotent: a company that already has a campaign id is a strict no-op;
 *  - persists via the EXISTING setAppGrowthAdTest setter (same field/pattern
 *    the manual endpoint uses — no new registry field invented);
 *  - creates at DEFAULT_DAILY_BUDGET_USD, which is only a PAUSED placeholder
 *    budget — the real funded budget is set at activation time;
 *  - never throws: a failure must not break registration or the sweep.
 */

const h = vi.hoisted(() => ({
  resolveAppVerified: vi.fn(),
  setAppGrowthAdTest: vi.fn(async () => true),
  createAdTestCampaign: vi.fn(),
  growthAdTestingEnabled: vi.fn(() => true),
  growthAdTestingCredentialConfigured: vi.fn(() => true),
  getPlanStatus: vi.fn(),
  isPaidTier: vi.fn(),
}))

vi.mock('@/lib/build/app-registry', () => ({
  resolveAppVerified: h.resolveAppVerified,
  setAppGrowthAdTest: h.setAppGrowthAdTest,
}))
vi.mock('@/lib/build/ad-testing', () => ({
  createAdTestCampaign: h.createAdTestCampaign,
  growthAdTestingEnabled: h.growthAdTestingEnabled,
  growthAdTestingCredentialConfigured: h.growthAdTestingCredentialConfigured,
  DEFAULT_DAILY_BUDGET_USD: 5,
  MAX_DAILY_BUDGET_USD: 25,
}))
vi.mock('@/lib/ainative/plan', () => ({
  getPlanStatus: h.getPlanStatus,
  isPaidTier: h.isPaidTier,
}))

const APP = {
  slug: 'acme',
  name: 'Acme Logistics',
  tagline: 'Freight, finally simple',
  chatId: 'c1',
  createdAt: '2026-01-01',
}

/**
 * A CONFIRMED resolveAppVerified() answer — a real entry, or a real
 * "no such company" (#1494). The third shape, `{ entry: null, verified: false }`,
 * is the unverified read and is written out explicitly at each use site so it
 * never gets mistaken for a confirmed miss.
 */
const verified = (entry: Record<string, unknown> | null) => ({ entry, verified: true })

beforeEach(() => {
  vi.clearAllMocks()
  h.resolveAppVerified.mockResolvedValue(verified({ ...APP }))
  h.setAppGrowthAdTest.mockResolvedValue(true)
  h.createAdTestCampaign.mockResolvedValue({ ok: true, campaignId: 'camp_auto_1' })
  h.growthAdTestingEnabled.mockReturnValue(true)
  h.growthAdTestingCredentialConfigured.mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('autoCreateAdTestCampaign (#1017)', () => {
  it('creates a PAUSED campaign using the company’s real stored name and tagline', async () => {
    const { autoCreateAdTestCampaign } = await import('@/lib/build/ad-test-autocreate')
    const result = await autoCreateAdTestCampaign('acme')

    expect(result).toEqual({ created: true, campaignId: 'camp_auto_1' })
    expect(h.createAdTestCampaign).toHaveBeenCalledTimes(1)
    expect(h.createAdTestCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: 'Acme Logistics',
        tagline: 'Freight, finally simple',
      }),
    )
  })

  it('persists the campaign id through the existing setAppGrowthAdTest setter', async () => {
    const { autoCreateAdTestCampaign } = await import('@/lib/build/ad-test-autocreate')
    await autoCreateAdTestCampaign('acme')
    expect(h.setAppGrowthAdTest).toHaveBeenCalledWith('acme', { campaignId: 'camp_auto_1' })
  })

  it('uses the shared DEFAULT_DAILY_BUDGET_USD placeholder budget', async () => {
    const { autoCreateAdTestCampaign, AUTO_CREATE_PLACEHOLDER_BUDGET_USD } =
      await import('@/lib/build/ad-test-autocreate')
    await autoCreateAdTestCampaign('acme')
    expect(h.createAdTestCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ dailyBudgetUsd: AUTO_CREATE_PLACEHOLDER_BUDGET_USD }),
    )
    expect(AUTO_CREATE_PLACEHOLDER_BUDGET_USD).toBeGreaterThan(0)
  })

  it('NEVER consults plan tier — a free-tier founder gets an auto-created campaign (#1017)', async () => {
    const { autoCreateAdTestCampaign } = await import('@/lib/build/ad-test-autocreate')
    const result = await autoCreateAdTestCampaign('acme')
    expect(result.created).toBe(true)
    expect(h.getPlanStatus).not.toHaveBeenCalled()
    expect(h.isPaidTier).not.toHaveBeenCalled()
  })

  it('is a strict no-op when the company already has a campaign id (idempotent)', async () => {
    h.resolveAppVerified.mockResolvedValue(verified({ ...APP, growthAdTestCampaignId: 'camp_existing' }))
    const { autoCreateAdTestCampaign } = await import('@/lib/build/ad-test-autocreate')
    const result = await autoCreateAdTestCampaign('acme')
    expect(result).toEqual({ created: false, campaignId: 'camp_existing', reason: 'already_exists' })
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
    expect(h.setAppGrowthAdTest).not.toHaveBeenCalled()
  })

  it('fails closed when the feature flag is off, without calling Meta', async () => {
    h.growthAdTestingEnabled.mockReturnValue(false)
    const { autoCreateAdTestCampaign } = await import('@/lib/build/ad-test-autocreate')
    const result = await autoCreateAdTestCampaign('acme')
    expect(result).toEqual({ created: false, reason: 'disabled' })
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
    expect(h.resolveAppVerified).not.toHaveBeenCalled()
  })

  it('fails closed when no Marketing API credential is configured, without calling Meta', async () => {
    h.growthAdTestingCredentialConfigured.mockReturnValue(false)
    const { autoCreateAdTestCampaign } = await import('@/lib/build/ad-test-autocreate')
    const result = await autoCreateAdTestCampaign('acme')
    expect(result).toEqual({ created: false, reason: 'credential_not_configured' })
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
  })

  it('reports honestly when the company is CONFIRMED not in the registry', async () => {
    h.resolveAppVerified.mockResolvedValue(verified(null))
    const { autoCreateAdTestCampaign } = await import('@/lib/build/ad-test-autocreate')
    const result = await autoCreateAdTestCampaign('nope')
    expect(result).toEqual({ created: false, reason: 'company_not_found' })
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // #1494 — an UNVERIFIED registry read is not a confirmed missing company
  // -------------------------------------------------------------------------
  it('reports lookup_failed (NOT company_not_found) when the registry read could not be completed (#1494)', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })
    const { autoCreateAdTestCampaign } = await import('@/lib/build/ad-test-autocreate')
    const result = await autoCreateAdTestCampaign('acme')
    expect(result).toEqual({ created: false, reason: 'lookup_failed' })
    // Safe direction unchanged: nothing is created, nothing is persisted.
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
    expect(h.setAppGrowthAdTest).not.toHaveBeenCalled()
  })

  it('reports lookup_failed when resolveAppVerified itself rejects, and still never throws (#1494)', async () => {
    h.resolveAppVerified.mockRejectedValue(new Error('ZeroDB down'))
    const { autoCreateAdTestCampaign } = await import('@/lib/build/ad-test-autocreate')
    const result = await autoCreateAdTestCampaign('acme')
    expect(result).toEqual({ created: false, reason: 'lookup_failed' })
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
  })

  it('surfaces a real Meta create failure without persisting anything', async () => {
    h.createAdTestCampaign.mockResolvedValue({ ok: false, reason: 'Invalid parameter' })
    const { autoCreateAdTestCampaign } = await import('@/lib/build/ad-test-autocreate')
    const result = await autoCreateAdTestCampaign('acme')
    expect(result).toEqual({ created: false, reason: 'Invalid parameter' })
    expect(h.setAppGrowthAdTest).not.toHaveBeenCalled()
  })

  it('falls back to the slug when the registry entry has no name', async () => {
    h.resolveAppVerified.mockResolvedValue(verified({ ...APP, name: undefined }))
    const { autoCreateAdTestCampaign } = await import('@/lib/build/ad-test-autocreate')
    await autoCreateAdTestCampaign('acme')
    expect(h.createAdTestCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ companyName: 'acme' }),
    )
  })

  it('never throws when a collaborator throws', async () => {
    // A non-registry collaborator, so this still covers the generic
    // catch-all reason path. (A throwing registry READ is #1494's
    // `lookup_failed` case, pinned separately above.)
    h.createAdTestCampaign.mockRejectedValue(new Error('Meta API down'))
    const { autoCreateAdTestCampaign } = await import('@/lib/build/ad-test-autocreate')
    const result = await autoCreateAdTestCampaign('acme')
    expect(result.created).toBe(false)
    expect(result.reason).toContain('Meta API down')
  })
})
