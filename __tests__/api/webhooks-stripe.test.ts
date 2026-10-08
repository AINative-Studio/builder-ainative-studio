import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'

/**
 * #1012 — POST /api/webhooks/stripe. The browser-independent half of paid
 * fulfillment. Until this existed, `plan` only ever landed on a company's
 * registry row via POST /api/build/subscription/verify, which runs ONLY if the
 * founder's browser survives the Stripe→Builder redirect. Production evidence:
 * 338 registry rows, 17 real founder accounts, exactly ONE company ever had
 * `plan` set (an internal staff enterprise bypass) — zero real Stripe
 * purchases ever round-tripped.
 *
 * Properties under test:
 *  - no signature header → 401, nothing fulfilled;
 *  - wrong-secret signature → 401, nothing fulfilled;
 *  - tampered body under an otherwise well-formed token → 401;
 *  - stale timestamp → 401 (replay protection);
 *  - a genuine checkout.session.completed actually stamps the plan via the
 *    SHARED fulfillment function (not a duplicated copy of the logic);
 *  - an unknown/absent slug is a 200 ack (Stripe must not be made to retry
 *    forever over a company Builder doesn't own) but fulfills nothing;
 *  - unpaid / non-completed sessions fulfill nothing;
 *  - unhandled event types are acked 200 without fulfillment;
 *  - customer.subscription.deleted / .updated(unpaid) never DOWNGRADE anything
 *    silently (Builder has no downgrade path; it is acked + reported only);
 *  - native Stripe-signature mode works when STRIPE_WEBHOOK_SECRET is set.
 *
 * All collaborators mocked — no real network, no real Stripe, no real ZeroDB.
 */

const CALLBACK_SECRET = 'test-callback-secret'
const STRIPE_SECRET = 'whsec_test_stripe'

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** core's existing HMAC callback scheme (same as /api/webhooks/ad-budget-confirmed). */
function signCallback(payload: object, secret = CALLBACK_SECRET): string {
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)))
  const sig = b64url(createHmac('sha256', secret).update(payloadB64).digest())
  return `${payloadB64}.${sig}`
}

/** Stripe's own `Stripe-Signature: t=…,v1=…` scheme over `t.rawBody`. */
function signStripe(rawBody: string, tsSec: number, secret = STRIPE_SECRET): string {
  const v1 = createHmac('sha256', secret).update(`${tsSec}.${rawBody}`).digest('hex')
  return `t=${tsSec},v1=${v1}`
}

const h = vi.hoisted(() => ({
  fulfillPaidPlan: vi.fn(),
  // The route resolves the company via resolveAppVerified, NOT resolveApp —
  // `resolveApp`'s single `null` return cannot distinguish "confirmed not in the
  // registry" from "the lookup itself failed", and acking 200 on the latter
  // permanently discarded real payments (#1012 review finding 2). The four
  // verified/entry combinations are pinned down in
  // __tests__/api/webhooks-stripe-retryable-1012.test.ts.
  resolveAppVerified: vi.fn(),
  markConverted: vi.fn(async () => undefined),
}))

vi.mock('@/lib/build/app-registry', () => ({
  fulfillPaidPlan: h.fulfillPaidPlan,
  resolveAppVerified: h.resolveAppVerified,
}))
vi.mock('@/lib/build/learning', () => ({ markConverted: h.markConverted }))

const nowSec = () => Math.floor(Date.now() / 1000)

/**
 * Build a request whose RAW bytes are exactly what we signed.
 *
 * `new TextEncoder().encode(s).buffer` — NOT `Buffer.from(s).buffer`. Node's
 * Buffer.from() allocates out of a shared pool for small strings, so `.buffer`
 * hands back the entire pool (8KB of unrelated bytes), not just this string's
 * slice. A signature verified over those bytes never matches — this silently
 * broke the Stripe-signature test until it was tracked down, and would
 * mis-represent the real route's behavior.
 */
function req(rawBody: string, headers: Record<string, string> = {}) {
  return {
    arrayBuffer: async () => new TextEncoder().encode(rawBody).buffer,
    headers: new Headers(headers),
  } as any
}

function callbackReq(payload: object, token?: string | null) {
  const raw = JSON.stringify(payload)
  const t = token === undefined ? signCallback(payload) : token
  return req(raw, t === null ? {} : { 'x-ainative-callback-token': t })
}

/** A realistic checkout.session.completed payload, in core's callback envelope. */
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

beforeEach(() => {
  vi.clearAllMocks()
  process.env.BUILDER_CALLBACK_SECRET = CALLBACK_SECRET
  delete process.env.STRIPE_WEBHOOK_SECRET
  h.fulfillPaidPlan.mockResolvedValue({
    ok: true, planSet: true, keyClaimed: false, keyClaimPending: true,
  })
  h.resolveAppVerified.mockResolvedValue({
    entry: { slug: 'agentive', chatId: 'c1', name: 'Agentive' },
    verified: true,
  })
})

afterEach(() => {
  delete process.env.BUILDER_CALLBACK_SECRET
  delete process.env.STRIPE_WEBHOOK_SECRET
})

describe('POST /api/webhooks/stripe (#1012) — signature rejection', () => {
  it('rejects a request with no signature header at all', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload(), null))
    expect(res.status).toBe(401)
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })

  it('rejects a signature made with the wrong secret', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const payload = completedPayload()
    const res: any = await POST(callbackReq(payload, signCallback(payload, 'wrong-secret')))
    expect(res.status).toBe(401)
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })

  it('rejects a structurally malformed token', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload(), 'not-a-token'))
    expect(res.status).toBe(401)
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })

  it('rejects a tampered payload — the plan in the body cannot be swapped after signing', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const honest = completedPayload({ plan: 'pro' })
    const token = signCallback(honest)
    // Same (valid) token, but the attacker rewrites the body to buy enterprise.
    const tamperedRaw = JSON.stringify({ ...honest, plan: 'enterprise' })
    const res: any = await POST(req(tamperedRaw, { 'x-ainative-callback-token': token }))
    // In the core-callback scheme the SIGNED payload is authoritative — the
    // route decodes the plan out of the signed bytes and never reads the
    // request body for it. So the tampered 'enterprise' is simply invisible:
    // the honestly-signed 'pro' is what gets fulfilled, and the upgraded tier
    // is never granted.
    expect(res.status).toBe(200)
    expect(h.fulfillPaidPlan).toHaveBeenCalledWith('agentive', 'pro')
    expect(h.fulfillPaidPlan).not.toHaveBeenCalledWith('agentive', 'enterprise')
  })

  it('rejects a stale timestamp even with a valid signature (replay protection)', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload({ ts: nowSec() - 60 * 60 })))
    expect(res.status).toBe(401)
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })

  it('rejects everything when no secret is configured at all (never fails open)', async () => {
    delete process.env.BUILDER_CALLBACK_SECRET
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const payload = completedPayload()
    const res: any = await POST(callbackReq(payload, signCallback(payload, '')))
    expect(res.status).toBe(401)
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })
})

describe('POST /api/webhooks/stripe (#1012) — checkout.session.completed', () => {
  it('fulfills a genuine completed checkout via the shared fulfillment function', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload()))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.planSet).toBe(true)
    // The honest signal that a tmp_ key still needs the founder's own session.
    expect(json.keyClaimPending).toBe(true)
    expect(h.fulfillPaidPlan).toHaveBeenCalledTimes(1)
    expect(h.fulfillPaidPlan).toHaveBeenCalledWith('agentive', 'pro')
  })

  it('accepts the Stripe-native metadata shape (metadata.slug / metadata.plan_id)', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const payload = {
      type: 'checkout.session.completed',
      ts: nowSec(),
      data: {
        object: {
          id: 'cs_test_456',
          payment_status: 'paid',
          status: 'complete',
          metadata: { slug: 'castlo', plan_id: 'business' },
        },
      },
    }
    const res: any = await POST(callbackReq(payload))
    expect(res.status).toBe(200)
    expect(h.fulfillPaidPlan).toHaveBeenCalledWith('castlo', 'business')
  })

  it('rejects a signed callback that names no company at all, and fulfills nothing', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload({ slug: '' })))
    // 401, not the old 200 + `no_slug` (#1012 review finding 4): a required
    // field is now part of signature verification, matching the sibling
    // /api/webhooks/ad-budget-confirmed. A correctly-signed payload that names
    // no company is malformed, so it is rejected at the boundary rather than
    // coerced to '' and reported vaguely downstream.
    expect(res.status).toBe(401)
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })

  it('acks 200 but fulfills nothing for a company CONFIRMED not in the registry', async () => {
    // verified:true + no entry — the registry answered, and the answer is that
    // this company genuinely does not exist.
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: true })
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload({ slug: 'ghost' })))
    // 200, not 404 and not a 5xx — a retry makes Stripe/core try forever over a
    // company Builder legitimately does not have and never will.
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.reason).toBe('company_not_found')
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })

  it('fulfills nothing when the session is not actually paid', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload({ paid: false })))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.reason).toBe('not_paid')
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })

  it('fulfills nothing when no plan id is resolvable from the event', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload({ plan: '' })))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.reason).toBe('no_plan')
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })

  it('surfaces a fulfillment refusal (free-tier plan id) without failing the ack', async () => {
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

  it('asks the sender to RETRY when fulfillment itself throws (a real payment must not be discarded)', async () => {
    h.fulfillPaidPlan.mockRejectedValue(new Error('zerodb down'))
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq(completedPayload()))
    // This previously acked 200 (#1012 review finding 2): a transient ZeroDB
    // write failure told the sender the payment was handled while the company
    // sat unfulfilled. A thrown write is retryable, so it is a 5xx — the
    // sender's own backoff, not a false ack, is what prevents a retry storm.
    expect(res.status).toBeGreaterThanOrEqual(500)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.reason).toBe('fulfillment_failed')
    expect(json.retryable).toBe(true)
  })
})

describe('POST /api/webhooks/stripe (#1012) — other event types', () => {
  it('acks an unhandled event type without fulfilling anything', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq({ type: 'invoice.paid', ts: nowSec(), slug: 'agentive' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ignored).toBe(true)
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })

  it('re-asserts the plan on customer.subscription.updated for an ACTIVE subscription', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq({
      type: 'customer.subscription.updated',
      ts: nowSec(),
      slug: 'agentive',
      plan: 'business',
      status: 'active',
    }))
    expect(res.status).toBe(200)
    expect(h.fulfillPaidPlan).toHaveBeenCalledWith('agentive', 'business')
  })

  it('never fulfills on customer.subscription.updated for a non-active subscription', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq({
      type: 'customer.subscription.updated',
      ts: nowSec(),
      slug: 'agentive',
      plan: 'business',
      status: 'past_due',
    }))
    expect(res.status).toBe(200)
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })

  it('never silently downgrades a company on customer.subscription.deleted', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res: any = await POST(callbackReq({
      type: 'customer.subscription.deleted',
      ts: nowSec(),
      slug: 'agentive',
      plan: 'pro',
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    // Acked and recorded as observed, but Builder has NO downgrade path and
    // must not invent one from a webhook — core's /auth/me stays the authority.
    expect(json.ok).toBe(true)
    expect(json.downgraded).toBe(false)
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })
})

describe('POST /api/webhooks/stripe (#1012) — native Stripe signature mode', () => {
  it('accepts a genuine Stripe-Signature when STRIPE_WEBHOOK_SECRET is configured', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_SECRET
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const raw = JSON.stringify({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_live_1',
          payment_status: 'paid',
          status: 'complete',
          metadata: { slug: 'agentive', plan_id: 'pro' },
        },
      },
    })
    const ts = nowSec()
    const res: any = await POST(req(raw, { 'stripe-signature': signStripe(raw, ts) }))
    expect(res.status).toBe(200)
    expect(h.fulfillPaidPlan).toHaveBeenCalledWith('agentive', 'pro')
  })

  it('rejects a Stripe-Signature signed with the wrong secret', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_SECRET
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } })
    const ts = nowSec()
    const res: any = await POST(req(raw, { 'stripe-signature': signStripe(raw, ts, 'whsec_wrong') }))
    expect(res.status).toBe(401)
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })

  it('rejects a Stripe-Signature with a stale timestamp (replay protection)', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_SECRET
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } })
    const res: any = await POST(req(raw, { 'stripe-signature': signStripe(raw, nowSec() - 60 * 60) }))
    expect(res.status).toBe(401)
  })

  it('rejects a body tampered after Stripe signed it', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_SECRET
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const honest = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { payment_status: 'paid', status: 'complete', metadata: { slug: 'agentive', plan_id: 'pro' } } },
    })
    const ts = nowSec()
    const sig = signStripe(honest, ts)
    const tampered = honest.replace('"pro"', '"enterprise"')
    const res: any = await POST(req(tampered, { 'stripe-signature': sig }))
    expect(res.status).toBe(401)
    expect(h.fulfillPaidPlan).not.toHaveBeenCalled()
  })
})
