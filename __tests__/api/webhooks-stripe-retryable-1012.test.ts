import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'

/**
 * #1012 code-review finding 2 — "COULDN'T CHECK" MUST NOT LOOK LIKE "CONFIRMED GONE".
 *
 * The webhook resolved the company with `resolveApp(slug).catch(() => null)`.
 * `resolveApp` collapses a ZeroDB 5xx / timeout / missing-configuration to the
 * SAME `null` it returns for a company that genuinely does not exist. So a
 * transient read failure was reported as `company_not_found` and ACKED 200 —
 * telling the sender "handled, stop retrying" and permanently discarding a real
 * payment.
 *
 * The repo already built `resolveAppVerified` (lib/build/app-registry.ts) for
 * exactly this conflation (#807/#832): it carries a `verified` flag saying
 * whether the answer is a real, confirmed result. It was sitting unused here.
 *
 * The four cases this pins down:
 *
 *   verified | entry  | meaning                        | response
 *   ---------+--------+--------------------------------+---------------------------
 *   true     | entry  | confirmed present              | 200, fulfilled
 *   true     | null   | confirmed gone                 | 200 ack, company_not_found
 *   false    | null   | lookup itself failed           | 5xx, registry_lookup_failed
 *   false    | entry  | (not produced) treat as failed  | 5xx, registry_lookup_failed
 *
 * A retry is exactly the correct behaviour for the unverified case and ONLY
 * that case — it is the one branch where the sender trying again can succeed.
 *
 * The same distinction applies to a fulfillment WRITE failure: a genuine ZeroDB
 * write error is transient and retryable, so `fulfillment_failed` must be a 5xx
 * too, not a 200 ack that throws the payment away.
 */

const CALLBACK_SECRET = 'test-callback-secret'

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function signCallback(payload: object, secret = CALLBACK_SECRET): string {
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)))
  const sig = b64url(createHmac('sha256', secret).update(payloadB64).digest())
  return `${payloadB64}.${sig}`
}

const h = vi.hoisted(() => ({
  fulfillPaidPlan: vi.fn(),
  resolveApp: vi.fn(),
  resolveAppVerified: vi.fn(),
  markConverted: vi.fn(async () => undefined),
}))

vi.mock('@/lib/build/app-registry', () => ({
  fulfillPaidPlan: h.fulfillPaidPlan,
  resolveApp: h.resolveApp,
  resolveAppVerified: h.resolveAppVerified,
}))
vi.mock('@/lib/build/learning', () => ({ markConverted: h.markConverted }))

const nowSec = () => Math.floor(Date.now() / 1000)

function req(rawBody: string, headers: Record<string, string> = {}) {
  return {
    arrayBuffer: async () => new TextEncoder().encode(rawBody).buffer,
    headers: new Headers(headers),
  } as any
}

function callbackReq(payload: object) {
  return req(JSON.stringify(payload), { 'x-ainative-callback-token': signCallback(payload) })
}

function completedPayload(over: Record<string, any> = {}) {
  return {
    type: 'checkout.session.completed',
    sessionId: 'cs_test_123',
    slug: 'agentive',
    plan: 'pro',
    paid: true,
    ts: nowSec(),
    ...over,
  }
}

const REAL_ENTRY = { slug: 'agentive', chatId: 'c1', name: 'Agentive' }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.BUILDER_CALLBACK_SECRET = CALLBACK_SECRET
  delete process.env.STRIPE_WEBHOOK_SECRET
  h.fulfillPaidPlan.mockResolvedValue({
    ok: true, planSet: true, keyClaimed: false, keyClaimPending: true,
  })
  h.resolveAppVerified.mockResolvedValue({ entry: REAL_ENTRY, verified: true })
})

afterEach(() => {
  delete process.env.BUILDER_CALLBACK_SECRET
  delete process.env.STRIPE_WEBHOOK_SECRET
})

describe('POST /api/webhooks/stripe — company resolution (#1012 review finding 2)', () => {
  it('uses resolveAppVerified, not the ambiguous resolveApp', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    await POST(callbackReq(completedPayload()))
    expect(h.resolveAppVerified).toHaveBeenCalledWith('agentive')
    // The fail-open call site is gone entirely.
    expect(h.resolveApp).not.toHaveBeenCalled()
  })

  it('verified + entry present → 200 and the plan IS fulfilled', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: REAL_ENTRY, verified: true })
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload()))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.planSet).toBe(true)
    expect(h.fulfillPaidPlan).toHaveBeenCalledWith('agentive', 'pro')
  })

  it('verified + null entry → CONFIRMED GONE: still a 200 ack with company_not_found', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: true })
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload({ slug: 'ghost' })))
    // 200, not 404 and NOT a 5xx — retrying will never make this company exist,
    // so the sender should stop.
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.reason).toBe('company_not_found')
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })

  it('UNVERIFIED + null entry → 5xx so the sender RETRIES, never a 200 that discards the payment', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload()))
    expect(res.status).toBeGreaterThanOrEqual(500)
    const json = await res.json()
    expect(json.ok).toBe(false)
    // Distinguishable from a genuine "this company doesn't exist".
    expect(json.reason).toBe('registry_lookup_failed')
    expect(json.reason).not.toBe('company_not_found')
    expect(json.retryable).toBe(true)
    // Nothing was written on an answer we could not trust.
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })

  it('UNVERIFIED even with an entry present → still 5xx (the answer is untrusted)', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: REAL_ENTRY, verified: false })
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload()))
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect((await res.json()).reason).toBe('registry_lookup_failed')
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })

  it('a THROWN registry lookup is an unverified lookup → 5xx, not a 200 ack', async () => {
    h.resolveAppVerified.mockRejectedValue(new Error('zerodb unreachable'))
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload()))
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect((await res.json()).reason).toBe('registry_lookup_failed')
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })
})

describe('POST /api/webhooks/stripe — fulfillment write failure (#1012 review finding 2)', () => {
  it('a THROWN fulfillment is transient → 5xx so the sender retries', async () => {
    h.fulfillPaidPlan.mockRejectedValue(new Error('zerodb write failed'))
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload()))
    expect(res.status).toBeGreaterThanOrEqual(500)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.reason).toBe('fulfillment_failed')
    expect(json.retryable).toBe(true)
  })

  it('a reported plan_write_failed is also transient → 5xx so the sender retries', async () => {
    h.fulfillPaidPlan.mockResolvedValue({
      ok: false, planSet: false, keyClaimed: false, keyClaimPending: false, reason: 'plan_write_failed',
    })
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload()))
    expect(res.status).toBeGreaterThanOrEqual(500)
    const json = await res.json()
    expect(json.reason).toBe('plan_write_failed')
    expect(json.retryable).toBe(true)
  })

  it('a DETERMINISTIC refusal (not_a_paid_plan) still acks 200 — retrying cannot help', async () => {
    h.fulfillPaidPlan.mockResolvedValue({
      ok: false, planSet: false, keyClaimed: false, keyClaimPending: false, reason: 'not_a_paid_plan',
    })
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload({ plan: 'hobbyist' })))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.reason).toBe('not_a_paid_plan')
  })

  it('an already-fulfilled re-delivery acks 200 (idempotent, nothing to retry)', async () => {
    h.fulfillPaidPlan.mockResolvedValue({
      ok: true, planSet: false, keyClaimed: false, keyClaimPending: false, reason: 'already_fulfilled',
    })
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload()))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })
})

describe('POST /api/webhooks/stripe — payload validation (#1012 review finding 4)', () => {
  it('rejects a correctly-signed payload with NO slug at the verification boundary', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload({ slug: undefined })))
    // 401 at the signature/validation boundary, like the sibling
    // ad-budget-confirmed webhook — not a fall-through to downstream
    // empty-string coercion.
    expect(res.status).toBe(401)
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
    expect(h.resolveAppVerified).not.toHaveBeenCalled()
  })

  it('rejects a correctly-signed payload with an EMPTY slug', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload({ slug: '   ' })))
    expect(res.status).toBe(401)
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })

  it('rejects a correctly-signed payload whose slug is not a string', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload({ slug: 12345 })))
    expect(res.status).toBe(401)
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })

  it('still accepts the Stripe-native envelope, where the slug lives in metadata', async () => {
    // The core-callback required-slug check must not break the native Stripe
    // event shape, which carries no top-level `slug` at all.
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_stripe'
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const raw = JSON.stringify({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_live_1',
          payment_status: 'paid',
          metadata: { slug: 'agentive', plan_id: 'pro' },
        },
      },
    })
    const ts = nowSec()
    const v1 = createHmac('sha256', 'whsec_test_stripe').update(`${ts}.${raw}`).digest('hex')
    const res: any = await POST(req(raw, { 'stripe-signature': `t=${ts},v1=${v1}` }))
    expect(res.status).toBe(200)
    expect(h.fulfillPaidPlan).toHaveBeenCalledWith('agentive', 'pro')
  })
})
