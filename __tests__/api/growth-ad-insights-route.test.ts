import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #449 — POST /api/build/growth/ad-insights (refresh + return a company's
 * ad-test campaign clicks/CPC snapshot for the Live dashboard's Growth card).
 * This route previously had zero test coverage.
 *
 * Properties under test:
 *  - requires a slug (400 on missing);
 *  - requires sign-in (reason:'signin' when anonymous);
 *  - 404s on an unknown company;
 *  - 503 lookup_failed (NOT a false 404) when the registry read itself fails
 *    (#832-class bug, same fix shape as connect-domain/#1336 et al.);
 *  - returns reason:'no_campaign' when the company has no test campaign yet;
 *  - refreshes + persists real clicks/CPC on success;
 *  - surfaces an insights-fetch failure honestly, never fabricates data.
 * All collaborators are mocked; no real network/Meta Ads call is made.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveAppVerified: vi.fn(),
  setAppGrowthAdInsights: vi.fn(async () => true),
  fetchAdTestInsights: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', () => ({
  resolveAppVerified: h.resolveAppVerified,
  setAppGrowthAdInsights: h.setAppGrowthAdInsights,
}))
vi.mock('@/lib/build/ad-testing', () => ({ fetchAdTestInsights: h.fetchAdTestInsights }))

import { POST } from '@/app/api/build/growth/ad-insights/route'

function postReq(body: unknown) {
  return { json: async () => body } as any
}

/** A confirmed resolveAppVerified() result — either a real entry or a confirmed miss. */
function verified(entry: Record<string, unknown> | null) {
  return { entry, verified: true }
}

const WITH_CAMPAIGN = { slug: 'acme', chatId: 'c1', createdAt: '2026-08-01T00:00:00Z', growthAdTestCampaignId: 'camp-1' }

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ accessToken: 'tok' })
  h.resolveAppVerified.mockResolvedValue(verified(WITH_CAMPAIGN))
  h.setAppGrowthAdInsights.mockResolvedValue(true)
})

describe('POST /api/build/growth/ad-insights (#449)', () => {
  it('requires a slug', async () => {
    const res: any = await POST(postReq({}))
    expect(res.status).toBe(400)
  })

  it('requires sign-in', async () => {
    h.auth.mockResolvedValue(null)
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'signin' })
    expect(h.fetchAdTestInsights).not.toHaveBeenCalled()
  })

  it('404s when the company does not exist', async () => {
    h.resolveAppVerified.mockResolvedValue(verified(null))
    const res: any = await POST(postReq({ slug: 'nope' }))
    const json = await res.json()
    expect(res.status).toBe(404)
    expect(json).toEqual({ ok: false, reason: 'company_not_found' })
  })

  // #832-class bug: a transient registry-read failure must never be presented
  // as a confident "company not found" to a founder refreshing their insights.
  it('503 lookup_failed when the registry read itself fails (NOT a false 404)', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(res.status).toBe(503)
    expect(json).toEqual({ ok: false, reason: 'lookup_failed' })
    expect(h.fetchAdTestInsights).not.toHaveBeenCalled()
  })

  it('503 lookup_failed when resolveAppVerified rejects outright', async () => {
    h.resolveAppVerified.mockRejectedValue(new Error('zerodb timeout'))
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(res.status).toBe(503)
    expect(json.reason).toBe('lookup_failed')
  })

  it('reports no_campaign when the company has no test campaign yet', async () => {
    h.resolveAppVerified.mockResolvedValue(verified({ slug: 'acme', chatId: 'c1', createdAt: '2026-08-01T00:00:00Z' }))
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'no_campaign' })
    expect(h.fetchAdTestInsights).not.toHaveBeenCalled()
  })

  it('refreshes and persists real clicks/CPC on success', async () => {
    h.fetchAdTestInsights.mockResolvedValue({ ok: true, clicks: 42, cpcCents: 35 })
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual({ ok: true, clicks: 42, cpcCents: 35 })
    expect(h.fetchAdTestInsights).toHaveBeenCalledWith('camp-1')
    expect(h.setAppGrowthAdInsights).toHaveBeenCalledWith('acme', { clicks: 42, cpcCents: 35 })
  })

  it('surfaces an insights-fetch failure honestly, never fabricates data', async () => {
    h.fetchAdTestInsights.mockResolvedValue({ ok: false, reason: 'meta_api_error' })
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'meta_api_error' })
    expect(h.setAppGrowthAdInsights).not.toHaveBeenCalled()
  })
})
