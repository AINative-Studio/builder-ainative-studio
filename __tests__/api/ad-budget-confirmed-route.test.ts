import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'

/**
 * #449 — POST /api/webhooks/ad-budget-confirmed. This is the ONLY place a
 * real Meta campaign gets created, gated on a verified HMAC-signed callback
 * from core. Properties under test:
 *  - rejects a request with no token (401, never calls the campaign client);
 *  - rejects a forged/wrong-secret signature (401);
 *  - rejects a tampered payload even with a structurally valid signature
 *    format (401);
 *  - rejects a stale (too-old) timestamp (401) — replay protection;
 *  - a genuinely valid, freshly-signed callback creates the campaign, records
 *    the funding, and returns ok;
 *  - an already-funded/campaigned company doesn't create a duplicate.
 * All collaborators are mocked; no real network/Meta call is made.
 */

const SECRET = 'test-callback-secret'

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function signPayload(payload: object, secret = SECRET): string {
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)))
  const sig = b64url(createHmac('sha256', secret).update(payloadB64).digest())
  return `${payloadB64}.${sig}`
}

const h = vi.hoisted(() => ({
  resolveApp: vi.fn(),
  setAppGrowthAdBudgetFunded: vi.fn(async () => true),
  setAppGrowthAdTest: vi.fn(async () => true),
  createAdTestCampaign: vi.fn(),
}))

vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: h.resolveApp,
  setAppGrowthAdBudgetFunded: h.setAppGrowthAdBudgetFunded,
  setAppGrowthAdTest: h.setAppGrowthAdTest,
}))
vi.mock('@/lib/build/ad-testing', () => ({ createAdTestCampaign: h.createAdTestCampaign }))

function req(body: any, token?: string | null) {
  return {
    arrayBuffer: async () => Buffer.from(JSON.stringify(body)).buffer,
    headers: new Headers(token !== undefined && token !== null ? { 'x-ainative-callback-token': token } : {}),
  } as any
}

const APP = { slug: 'acme', name: 'Acme', chatId: 'c1', createdAt: '2026-01-01' }
const nowSec = () => Math.floor(Date.now() / 1000)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.BUILDER_CALLBACK_SECRET = SECRET
  h.resolveApp.mockResolvedValue(APP)
  h.setAppGrowthAdBudgetFunded.mockResolvedValue(true)
  h.setAppGrowthAdTest.mockResolvedValue(true)
  h.createAdTestCampaign.mockResolvedValue({ ok: true, campaignId: 'camp_123' })
})

afterEach(() => {
  delete process.env.BUILDER_CALLBACK_SECRET
})

describe('POST /api/webhooks/ad-budget-confirmed (#449)', () => {
  it('rejects a request with no token', async () => {
    const { POST } = await import('@/app/api/webhooks/ad-budget-confirmed/route')
    const res: any = await POST(req({ slug: 'acme' }, null))
    expect(res.status).toBe(401)
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
  })

  it('rejects a signature made with the wrong secret', async () => {
    const { POST } = await import('@/app/api/webhooks/ad-budget-confirmed/route')
    const payload = { slug: 'acme', paymentIntentId: 'pi_1', requestedAmountCents: 1000, adBudgetCents: 800, ts: nowSec() }
    const badToken = signPayload(payload, 'wrong-secret')
    const res: any = await POST(req(payload, badToken))
    expect(res.status).toBe(401)
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
  })

  it('rejects a structurally malformed token', async () => {
    const { POST } = await import('@/app/api/webhooks/ad-budget-confirmed/route')
    const res: any = await POST(req({ slug: 'acme' }, 'not-a-valid-token'))
    expect(res.status).toBe(401)
  })

  it('rejects a stale (too old) timestamp even with a valid signature', async () => {
    const { POST } = await import('@/app/api/webhooks/ad-budget-confirmed/route')
    const staleTs = nowSec() - 60 * 60 // 1 hour old, well past the 15-min window
    const payload = { slug: 'acme', paymentIntentId: 'pi_1', requestedAmountCents: 1000, adBudgetCents: 800, ts: staleTs }
    const token = signPayload(payload)
    const res: any = await POST(req(payload, token))
    expect(res.status).toBe(401)
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
  })

  it('rejects a payload missing required fields even with a valid signature over it', async () => {
    const { POST } = await import('@/app/api/webhooks/ad-budget-confirmed/route')
    const payload = { slug: 'acme', ts: nowSec() } // missing paymentIntentId/adBudgetCents
    const token = signPayload(payload)
    const res: any = await POST(req(payload, token))
    expect(res.status).toBe(401)
  })

  it('a genuinely valid callback creates the campaign and records funding', async () => {
    const { POST } = await import('@/app/api/webhooks/ad-budget-confirmed/route')
    const payload = { slug: 'acme', userId: 'u1', paymentIntentId: 'pi_1', requestedAmountCents: 1000, adBudgetCents: 800, ts: nowSec() }
    const token = signPayload(payload)
    const res: any = await POST(req(payload, token))
    const json = await res.json()
    expect(json).toEqual({ ok: true, campaignId: 'camp_123' })
    expect(h.setAppGrowthAdBudgetFunded).toHaveBeenCalledWith('acme', {
      paymentIntentId: 'pi_1', requestedCents: 1000, realCents: 800,
    })
    expect(h.createAdTestCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ companyName: 'Acme', dailyBudgetUsd: 8 }),
    )
    expect(h.setAppGrowthAdTest).toHaveBeenCalledWith('acme', { campaignId: 'camp_123' })
  })

  it('does not create a duplicate campaign for a company that already has one', async () => {
    h.resolveApp.mockResolvedValue({ ...APP, growthAdTestCampaignId: 'camp_existing' })
    const { POST } = await import('@/app/api/webhooks/ad-budget-confirmed/route')
    const payload = { slug: 'acme', paymentIntentId: 'pi_2', requestedAmountCents: 1000, adBudgetCents: 800, ts: nowSec() }
    const token = signPayload(payload)
    const res: any = await POST(req(payload, token))
    const json = await res.json()
    expect(json).toEqual({ ok: true, campaignId: 'camp_existing', alreadyExisted: true })
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
    // Funding is still recorded even though no new campaign is created.
    expect(h.setAppGrowthAdBudgetFunded).toHaveBeenCalled()
  })

  it('404s on an unknown company', async () => {
    h.resolveApp.mockResolvedValue(null)
    const { POST } = await import('@/app/api/webhooks/ad-budget-confirmed/route')
    const payload = { slug: 'nope', paymentIntentId: 'pi_3', requestedAmountCents: 1000, adBudgetCents: 800, ts: nowSec() }
    const token = signPayload(payload)
    const res: any = await POST(req(payload, token))
    expect(res.status).toBe(404)
  })
})
