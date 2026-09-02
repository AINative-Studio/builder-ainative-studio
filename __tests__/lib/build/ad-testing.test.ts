import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createAdTestCampaign, growthAdTestingEnabled, growthAdTestingCredentialConfigured } from '@/lib/build/ad-testing'

/**
 * lib/build/ad-testing — Growth module ad-testing client (#449).
 * Covers: the feature flag, the separate credential-configured check, input
 * validation, the real campaign-create call (hardcoded PAUSED status — never
 * caller-overridable, a real safety invariant), error shapes, and
 * never-throws. All fetch calls are mocked — no real Meta Ads campaign is
 * ever created by these tests.
 */

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; status?: number; json?: object }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = impl(String(url), init)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => (r.json ?? {}),
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const saved = { ...process.env }
afterEach(() => {
  process.env = { ...saved }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('growthAdTestingEnabled (#449 feature flag)', () => {
  it('is false by default (env unset)', () => {
    delete process.env.GROWTH_AD_TESTING_ENABLED
    expect(growthAdTestingEnabled()).toBe(false)
  })

  it('is false for any value other than the literal string "true"', () => {
    process.env.GROWTH_AD_TESTING_ENABLED = '1'
    expect(growthAdTestingEnabled()).toBe(false)
  })

  it('is true only when explicitly set to "true"', () => {
    process.env.GROWTH_AD_TESTING_ENABLED = 'true'
    expect(growthAdTestingEnabled()).toBe(true)
  })
})

describe('growthAdTestingCredentialConfigured (#449)', () => {
  it('is false when neither env var is set', () => {
    delete process.env.METAADS_ACCESS_TOKEN
    delete process.env.METAADS_AD_ACCOUNT_ID
    expect(growthAdTestingCredentialConfigured()).toBe(false)
  })

  it('is false when only one of the two is set', () => {
    process.env.METAADS_ACCESS_TOKEN = 'tok'
    delete process.env.METAADS_AD_ACCOUNT_ID
    expect(growthAdTestingCredentialConfigured()).toBe(false)
  })

  it('is true only when both are set', () => {
    process.env.METAADS_ACCESS_TOKEN = 'tok'
    process.env.METAADS_AD_ACCOUNT_ID = '123456'
    expect(growthAdTestingCredentialConfigured()).toBe(true)
  })
})

describe('createAdTestCampaign (#449)', () => {
  it('returns { ok: false, reason: "credential_not_configured" } when the Marketing API credential is missing, without ever calling fetch', async () => {
    delete process.env.METAADS_ACCESS_TOKEN
    delete process.env.METAADS_AD_ACCOUNT_ID
    const fn = mockFetch(() => ({ ok: true, json: { id: '123' } }))
    const result = await createAdTestCampaign({ companyName: 'Acme', dailyBudgetUsd: 10 })
    expect(result).toEqual({ ok: false, reason: 'credential_not_configured' })
    expect(fn).not.toHaveBeenCalled()
  })

  describe('with a configured credential', () => {
    beforeEach(() => {
      process.env.METAADS_ACCESS_TOKEN = 'real-token'
      process.env.METAADS_AD_ACCOUNT_ID = '999888777'
    })

    it('returns { ok: false, reason: "company_name_required" } for an empty company name, without calling fetch', async () => {
      const fn = mockFetch(() => ({ ok: true, json: { id: '123' } }))
      const result = await createAdTestCampaign({ companyName: '', dailyBudgetUsd: 10 })
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('company_name_required')
      expect(fn).not.toHaveBeenCalled()
    })

    it('returns { ok: false, reason: "invalid_budget" } for a zero/negative/NaN budget', async () => {
      const fn = mockFetch(() => ({ ok: true, json: { id: '123' } }))
      for (const bad of [0, -5, NaN]) {
        const result = await createAdTestCampaign({ companyName: 'Acme', dailyBudgetUsd: bad })
        expect(result.ok).toBe(false)
        expect(result.reason).toBe('invalid_budget')
      }
      expect(fn).not.toHaveBeenCalled()
    })

    it('creates a real campaign, hardcoded PAUSED, converting USD to cents', async () => {
      let capturedBody: any = null
      const fn = mockFetch((url, init) => {
        capturedBody = JSON.parse(String(init?.body))
        expect(url).toContain('/act_999888777/campaigns')
        return { ok: true, json: { id: 'camp_real_123' } }
      })
      const result = await createAdTestCampaign({ companyName: 'Acme', dailyBudgetUsd: 10 })
      expect(result).toEqual({ ok: true, campaignId: 'camp_real_123', status: 200 })
      expect(capturedBody.status).toBe('PAUSED')
      expect(capturedBody.daily_budget).toBe('1000') // $10 -> 1000 cents
      expect(capturedBody.name).toContain('Acme')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('caps daily_budget conversion correctly for fractional dollars', async () => {
      let capturedBody: any = null
      mockFetch((_url, init) => {
        capturedBody = JSON.parse(String(init?.body))
        return { ok: true, json: { id: 'camp_1' } }
      })
      await createAdTestCampaign({ companyName: 'Acme', dailyBudgetUsd: 7.5 })
      expect(capturedBody.daily_budget).toBe('750')
    })

    it('surfaces a real Meta API error honestly', async () => {
      mockFetch(() => ({ ok: false, status: 400, json: { error: { message: 'Invalid parameter' } } }))
      const result = await createAdTestCampaign({ companyName: 'Acme', dailyBudgetUsd: 10 })
      expect(result.ok).toBe(false)
      expect(result.status).toBe(400)
      expect(result.reason).toContain('Invalid parameter')
    })

    it('returns { ok: false, reason: "campaign_response_missing_id" } for a malformed success response', async () => {
      mockFetch(() => ({ ok: true, json: {} }))
      const result = await createAdTestCampaign({ companyName: 'Acme', dailyBudgetUsd: 10 })
      expect(result).toEqual({ ok: false, reason: 'campaign_response_missing_id' })
    })

    it('never throws when fetch throws a network error', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))
      const result = await createAdTestCampaign({ companyName: 'Acme', dailyBudgetUsd: 10 })
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('ECONNRESET')
    })
  })
})
