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
  resolveAppVerified: vi.fn(),
  setAppGrowthAdBudgetFunded: vi.fn(async () => true),
  setAppGrowthAdTest: vi.fn(async () => true),
  createAdTestCampaign: vi.fn(),
  activateAdTestCampaign: vi.fn(),
}))

vi.mock('@/lib/build/app-registry', () => ({
  resolveAppVerified: h.resolveAppVerified,
  setAppGrowthAdBudgetFunded: h.setAppGrowthAdBudgetFunded,
  setAppGrowthAdTest: h.setAppGrowthAdTest,
}))
vi.mock('@/lib/build/ad-testing', () => ({
  createAdTestCampaign: h.createAdTestCampaign,
  activateAdTestCampaign: h.activateAdTestCampaign,
}))

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
  h.resolveAppVerified.mockResolvedValue({ entry: APP, verified: true })
  h.setAppGrowthAdBudgetFunded.mockResolvedValue(true)
  h.setAppGrowthAdTest.mockResolvedValue(true)
  h.createAdTestCampaign.mockResolvedValue({ ok: true, campaignId: 'camp_123' })
  h.activateAdTestCampaign.mockResolvedValue({ ok: true, campaignId: 'camp_existing' })
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
    h.resolveAppVerified.mockResolvedValue({ entry: { ...APP, growthAdTestCampaignId: 'camp_existing' }, verified: true })
    const { POST } = await import('@/app/api/webhooks/ad-budget-confirmed/route')
    const payload = { slug: 'acme', paymentIntentId: 'pi_2', requestedAmountCents: 1000, adBudgetCents: 800, ts: nowSec() }
    const token = signPayload(payload)
    const res: any = await POST(req(payload, token))
    const json = await res.json()
    // #1017: the pre-existing campaign is now ACTIVATED rather than no-op'd —
    // an auto-created PAUSED campaign is exactly what lands in this branch,
    // and the founder has just paid for credits.
    expect(json).toEqual({ ok: true, campaignId: 'camp_existing', alreadyExisted: true, activated: true })
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
    // Funding is still recorded even though no new campaign is created.
    expect(h.setAppGrowthAdBudgetFunded).toHaveBeenCalled()
  })

  it('404s on an unknown company', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: true })
    const { POST } = await import('@/app/api/webhooks/ad-budget-confirmed/route')
    const payload = { slug: 'nope', paymentIntentId: 'pi_3', requestedAmountCents: 1000, adBudgetCents: 800, ts: nowSec() }
    const token = signPayload(payload)
    const res: any = await POST(req(payload, token))
    expect(res.status).toBe(404)
  })

  it('503s with lookup_failed (never a fabricated 404) when the registry read itself fails', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })
    const { POST } = await import('@/app/api/webhooks/ad-budget-confirmed/route')
    const payload = { slug: 'acme', paymentIntentId: 'pi_4', requestedAmountCents: 1000, adBudgetCents: 800, ts: nowSec() }
    const token = signPayload(payload)
    const res: any = await POST(req(payload, token))
    const json = await res.json()
    expect(res.status).toBe(503)
    expect(json).toEqual({ ok: false, reason: 'lookup_failed' })
    expect(h.setAppGrowthAdBudgetFunded).not.toHaveBeenCalled()
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
    expect(h.activateAdTestCampaign).not.toHaveBeenCalled()
  })

  it('503s with lookup_failed when resolveAppVerified itself rejects, never fabricating a 404', async () => {
    h.resolveAppVerified.mockRejectedValue(new Error('zerodb timeout'))
    const { POST } = await import('@/app/api/webhooks/ad-budget-confirmed/route')
    const payload = { slug: 'acme', paymentIntentId: 'pi_5', requestedAmountCents: 1000, adBudgetCents: 800, ts: nowSec() }
    const token = signPayload(payload)
    const res: any = await POST(req(payload, token))
    expect(res.status).toBe(503)
    expect(h.setAppGrowthAdBudgetFunded).not.toHaveBeenCalled()
  })
})

/**
 * #1017 — activating the AUTO-CREATED campaign instead of creating a duplicate.
 *
 * With #1017's auto-create, by the time a founder's prepaid-credit payment
 * clears, their company already HAS a PAUSED campaign. This webhook's old
 * `growthAdTestCampaignId` branch was a pure no-op ("alreadyExisted"), so the
 * money would clear and the campaign would stay paused forever. The composition
 * rule: creation is still exactly once (whichever path got there first), and
 * activation is the one new step the confirmed payment unlocks.
 *
 * Confirmed payment is the ONLY gate — no plan-tier check, by design: a
 * free-tier founder who bought credits is entitled to run the campaign.
 */
describe('POST /api/webhooks/ad-budget-confirmed — activation (#1017)', () => {
  const FUNDED = { slug: 'acme', paymentIntentId: 'pi_act', requestedAmountCents: 1000, adBudgetCents: 800, ts: nowSec() }

  it('ACTIVATES the existing PAUSED campaign rather than creating a duplicate', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { ...APP, growthAdTestCampaignId: 'camp_auto_1' }, verified: true })
    h.activateAdTestCampaign.mockResolvedValue({ ok: true, campaignId: 'camp_auto_1' })
    const { POST } = await import('@/app/api/webhooks/ad-budget-confirmed/route')
    const res: any = await POST(req(FUNDED, signPayload(FUNDED)))
    const json = await res.json()

    expect(h.activateAdTestCampaign).toHaveBeenCalledWith('camp_auto_1')
    expect(h.createAdTestCampaign).not.toHaveBeenCalled()
    expect(json.ok).toBe(true)
    expect(json.campaignId).toBe('camp_auto_1')
    expect(json.activated).toBe(true)
  })

  it('records the funding BEFORE attempting activation, so a failed activation never loses the payment', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { ...APP, growthAdTestCampaignId: 'camp_auto_1' }, verified: true })
    h.activateAdTestCampaign.mockResolvedValue({ ok: false, reason: 'Campaign cannot be activated' })
    const { POST } = await import('@/app/api/webhooks/ad-budget-confirmed/route')
    const res: any = await POST(req(FUNDED, signPayload(FUNDED)))
    const json = await res.json()

    expect(h.setAppGrowthAdBudgetFunded).toHaveBeenCalledWith('acme', {
      paymentIntentId: 'pi_act', requestedCents: 1000, realCents: 800,
    })
    // Honest about the failure — never reports activated:true on a failed call.
    expect(json.activated).toBe(false)
    expect(json.reason).toContain('Campaign cannot be activated')
  })

  it('does NOT activate anything when the company has no campaign yet — it creates one (still PAUSED)', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { ...APP }, verified: true })
    const { POST } = await import('@/app/api/webhooks/ad-budget-confirmed/route')
    const res: any = await POST(req(FUNDED, signPayload(FUNDED)))
    const json = await res.json()

    expect(h.createAdTestCampaign).toHaveBeenCalledTimes(1)
    expect(json.campaignId).toBe('camp_123')
    expect(json.ok).toBe(true)
  })

  it('never activates on an unverified/forged callback — no payment, no activation', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { ...APP, growthAdTestCampaignId: 'camp_auto_1' }, verified: true })
    const { POST } = await import('@/app/api/webhooks/ad-budget-confirmed/route')
    const res: any = await POST(req(FUNDED, signPayload(FUNDED, 'wrong-secret')))
    expect(res.status).toBe(401)
    expect(h.activateAdTestCampaign).not.toHaveBeenCalled()
  })

  it('never activates on a stale/replayed callback', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { ...APP, growthAdTestCampaignId: 'camp_auto_1' }, verified: true })
    const stale = { ...FUNDED, ts: nowSec() - 60 * 60 }
    const { POST } = await import('@/app/api/webhooks/ad-budget-confirmed/route')
    const res: any = await POST(req(stale, signPayload(stale)))
    expect(res.status).toBe(401)
    expect(h.activateAdTestCampaign).not.toHaveBeenCalled()
  })

  it('never activates for an unknown company', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: true })
    const { POST } = await import('@/app/api/webhooks/ad-budget-confirmed/route')
    const res: any = await POST(req(FUNDED, signPayload(FUNDED)))
    expect(res.status).toBe(404)
    expect(h.activateAdTestCampaign).not.toHaveBeenCalled()
  })

  it('never throws when activation itself rejects', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { ...APP, growthAdTestCampaignId: 'camp_auto_1' }, verified: true })
    h.activateAdTestCampaign.mockRejectedValue(new Error('ECONNRESET'))
    const { POST } = await import('@/app/api/webhooks/ad-budget-confirmed/route')
    const res: any = await POST(req(FUNDED, signPayload(FUNDED)))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.activated).toBe(false)
  })
})
