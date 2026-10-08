/**
 * POST /api/webhooks/stripe (#1012) — BROWSER-INDEPENDENT paid fulfillment.
 *
 * THE BUG THIS CLOSES. Until this route existed, a company's `plan` was only
 * ever stamped by POST /api/build/subscription/verify, which runs exclusively
 * when the founder's browser completes the full Stripe→Builder redirect back
 * to /build?screen=live&upgraded=1&session_id=… (see that route's own comment:
 * "Return-URL verification is the MVP path; a hardened Stripe webhook is
 * deferred"). A closed tab, a network blip, or an ad-blocker on that ONE
 * redirect left a genuinely paying founder permanently on `plan: null` and a
 * 72-hour `tmp_` Instant DB key that silently expired — with no retry anywhere.
 *
 * Measured in production (2026-10-08): `builder_app_registry` held 338 rows
 * across 17 real founder accounts, and EXACTLY ONE company had ever had `plan`
 * set — an internal @ainative.studio staff account via the enterprise bypass.
 * Zero real external Stripe purchases had ever round-tripped. Confirmed
 * casualties include greg.c.rose@gmail.com (Castlo, Flipsight) and
 * amador@selfpreneur.com (Agentive), the last of whom core's own regression
 * test (core#7861) independently documents as a real paying Pro customer.
 *
 * #855's `reconcilePlanFulfillment` (lib/build/app-registry.ts, invoked from
 * GET /api/build/subscription/status) retries fulfillment on Live dashboard
 * load. That helps, but only for a founder who actually revisits that one
 * screen after paying. This route removes the browser from the loop entirely.
 *
 * ── SIGNATURE VERIFICATION (two accepted schemes) ───────────────────────────
 * Builder does NOT hold a Stripe secret key and never talks to Stripe directly
 * — core owns the Stripe integration, and Builder's checkout is a proxy to
 * core's POST /api/v1/public/pricing/checkout. So the PRIMARY scheme here is
 * core's own already-deployed signed-callback format, identical to
 * /api/webhooks/ad-budget-confirmed (which core calls from its real Stripe
 * payment_intent.succeeded handler, see payment_webhooks.py on core):
 *
 *   x-ainative-callback-token:
 *     base64url(payloadJsonBytes).base64url(hmacSha256(BUILDER_CALLBACK_SECRET, payloadB64))
 *
 * The SIGNED payload is authoritative — we act on the bytes that were signed,
 * never on a separately-parsed request body, so a tampered body under a
 * replayed token cannot change which plan gets granted.
 *
 * Also accepted, so Stripe can be pointed straight at Builder without any core
 * change if that's ever preferred: Stripe's native
 *   Stripe-Signature: t=<unix>,v1=<hex hmacSha256(STRIPE_WEBHOOK_SECRET, "t.rawBody")>
 * verified over the RAW request bytes. Inert unless STRIPE_WEBHOOK_SECRET is
 * configured. This is implemented by hand (constant-time compare, timestamp
 * tolerance) rather than by adding the `stripe` SDK — the repo has no Stripe
 * dependency and this is the entire surface we need from it.
 *
 * FAILS CLOSED: with no secret configured, every request is 401. There is no
 * unauthenticated path to fulfillment.
 *
 * ── WHEN TO ACK (200) AND WHEN TO ASK FOR A RETRY (5xx) ─────────────────────
 * Stripe (and core's relay) retry on any non-2xx, with backoff, for days, so a
 * blanket non-2xx turns a non-actionable event into a retry storm. But the
 * inverse — acking everything — is worse, and was a real defect here: a
 * transient ZeroDB read failure was reported as `company_not_found` and acked
 * 200, telling the sender "handled, stop retrying" and PERMANENTLY DISCARDING a
 * real payment. The split is therefore by whether a retry can actually succeed:
 *
 *   401  — failed signature or a malformed signed payload. The security
 *          boundary; retrying the same bad token never helps.
 *   200  — DETERMINISTIC non-actionability. This event is genuinely nothing to
 *          do (wrong type, unpaid, no slug, no plan), or the company is
 *          CONFIRMED not in the registry, or it is already fulfilled. Retrying
 *          would produce the identical answer forever, so the sender should
 *          stop.
 *   5xx  — TRANSIENT failure. We could not CHECK (registry lookup unverified)
 *          or could not WRITE (fulfillment threw / the plan write failed). The
 *          event is real and still unfulfilled, and a retry is exactly the
 *          correct behaviour — this is the one case where trying again works.
 *          Carries `retryable: true` so the intent is explicit, not inferred
 *          from the status code alone.
 *
 * The load-bearing distinction is "couldn't check" vs "confirmed gone", which
 * `resolveApp`'s plain `null` return cannot express — hence `resolveAppVerified`
 * (#807/#832) and its `verified` flag, which exists for precisely this.
 * #855's `reconcilePlanFulfillment` is still a backstop on the founder's next
 * Live load, but it must not be the ONLY thing standing between a real payment
 * and fulfillment.
 *
 * ── THE ONE THING A WEBHOOK CANNOT DO ───────────────────────────────────────
 * Fulfillment is two steps: stamp the plan, and upgrade a `tmp_` project to
 * permanent. The second calls core's /api/v1/public/instant-db/claim, which
 * associates a project to a SPECIFIC real account and requires that account's
 * own bearer token. A webhook has no session, and CODY.md Rule 5 explicitly
 * forbids borrowing a founder's identity or falling back to an anonymous
 * service-level provisioning path. So this route performs the plan stamp (the
 * part that unblocks every paid gate, and the actual reported breakage) and
 * reports `keyClaimPending: true` when a claim is still outstanding. The
 * founder's next authenticated Live load completes it via
 * `reconcilePlanFulfillment`, which by then finds a correct plan already
 * stamped. Both halves are idempotent, so the overlap is harmless.
 */

import { NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { fulfillPaidPlan, resolveAppVerified } from '@/lib/build/app-registry'
import { markConverted } from '@/lib/build/learning'

export const runtime = 'nodejs'

/**
 * Both secrets are read PER REQUEST, not captured at module load. A webhook
 * endpoint's secret is exactly the kind of value that gets added/rotated in
 * Railway without a code change, and a module-scope capture would pin whatever
 * was present when the route module was first evaluated — silently 401-ing
 * every delivery until a redeploy happened to re-evaluate it. Reading
 * process.env on each call is free here and removes that failure mode.
 */
function callbackSecret(): string {
  return process.env.BUILDER_CALLBACK_SECRET || ''
}
function stripeWebhookSecret(): string {
  return process.env.STRIPE_WEBHOOK_SECRET || ''
}

/**
 * Replay window. Stripe legitimately retries for days, but it re-signs with a
 * fresh timestamp each attempt, so a tolerance this tight never rejects a real
 * retry — it only rejects a captured-and-replayed payload.
 */
const MAX_AGE_SECONDS = 15 * 60

const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
])

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/** Constant-time string compare that never throws on a length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

function freshTs(tsSec: unknown): boolean {
  const ts = Number(tsSec)
  if (!Number.isFinite(ts)) return false
  return Math.abs(Date.now() / 1000 - ts) <= MAX_AGE_SECONDS
}

/**
 * Verify core's signed-callback token. Returns the payload decoded from the
 * SIGNED bytes (not from the request body) so what we authorize is exactly
 * what was authenticated.
 */
function verifyCoreCallback(token: string | null): Record<string, any> | null {
  const secret = callbackSecret()
  if (!secret || !token) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = b64url(createHmac('sha256', secret).update(payloadB64).digest())
  if (!safeEqual(sig, expected)) return null

  let payload: Record<string, any>
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'))
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object') return null
  // Replay protection — a signed payload from an hour ago has no legitimate
  // reason to arrive now (core signs each delivery attempt freshly).
  if (!freshTs(payload.ts)) return null

  // REQUIRED FIELDS ARE PART OF VERIFICATION (#1012 review finding 4), matching
  // the sibling /api/webhooks/ad-budget-confirmed, whose verifyCallback likewise
  // requires its own payload essentials before returning success. A
  // correctly-signed payload that names no company at all is MALFORMED, not
  // merely unactionable — rejecting it at the boundary beats falling through to
  // downstream String() coercion of undefined into '' and a vague `no_slug`.
  //
  // Checked against the FULLY EXTRACTED slug, not just the top-level field.
  // core's flat envelope puts it at `slug`, but this same scheme is also used to
  // relay a nested Stripe event object whose company lives in
  // data.object.metadata — requiring the top-level field alone would reject
  // those legitimately-signed deliveries (caught by the existing
  // "accepts the Stripe-native metadata shape" test).
  if (!extractFulfillment(payload).slug) return null

  // An explicitly present but non-string/blank `slug` is malformed regardless of
  // what a fallback field happens to supply.
  if ('slug' in payload && (typeof payload.slug !== 'string' || payload.slug.trim() === '')) return null

  return payload
}

/**
 * Verify Stripe's own `t=…,v1=…` signature over the raw body bytes. Supports
 * multiple v1 values (Stripe sends one per active endpoint secret during a
 * secret rotation), accepting if ANY matches.
 */
function verifyStripeSignature(rawBody: string, header: string | null): Record<string, any> | null {
  const secret = stripeWebhookSecret()
  if (!secret || !header) return null
  let ts = ''
  const v1s: string[] = []
  for (const part of header.split(',')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (k === 't') ts = v
    else if (k === 'v1') v1s.push(v)
  }
  if (!ts || v1s.length === 0) return null
  if (!freshTs(ts)) return null

  const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex')
  if (!v1s.some((v) => safeEqual(v, expected))) return null

  try {
    const event = JSON.parse(rawBody)
    return event && typeof event === 'object' ? event : null
  } catch {
    return null
  }
}

/**
 * Normalize either envelope — core's flat callback payload or a real Stripe
 * event object — into the three things fulfillment actually needs.
 *
 * Builder's checkout success_url carries the company as a `company=` query
 * param, and core's checkout call is where `metadata` would be set; both
 * shapes are read here so neither side has to change first. The explicitly
 * SIGNED flat fields (`slug`/`plan`) take precedence, since those come from
 * core having already verified the session against Stripe itself.
 */
function extractFulfillment(event: Record<string, any>): {
  type: string
  slug: string
  plan: string
  paid: boolean
  subscriptionStatus: string
  sessionId: string
} {
  const type = String(event?.type || '')
  const obj = event?.data?.object || {}
  const md = obj?.metadata || {}

  const slug = String(event?.slug || md?.slug || md?.company || md?.company_id || obj?.client_reference_id || '').trim()
  const plan = String(event?.plan || event?.plan_id || md?.plan_id || md?.plan || obj?.plan?.id || '').trim()

  // Paid-ness: core's flat callback states it outright; a raw Stripe session
  // states it as payment_status/status. Absent both, treat as NOT paid.
  const paid =
    typeof event?.paid === 'boolean'
      ? event.paid
      : obj?.payment_status === 'paid' || obj?.payment_status === 'no_payment_required'

  const subscriptionStatus = String(event?.status || obj?.status || '').trim()
  const sessionId = String(event?.sessionId || event?.session_id || obj?.id || '').trim()

  return { type, slug, plan, paid, subscriptionStatus, sessionId }
}

export async function POST(request: NextRequest) {
  const rawBody = Buffer.from(await request.arrayBuffer()).toString('utf8')

  // Either accepted scheme authenticates the request; neither configured means
  // every request is rejected (fails closed — no unauthenticated fulfillment).
  const event =
    verifyCoreCallback(request.headers.get('x-ainative-callback-token')) ??
    verifyStripeSignature(rawBody, request.headers.get('stripe-signature'))

  if (!event) {
    return Response.json({ ok: false, reason: 'invalid_signature' }, { status: 401 })
  }

  const { type, slug, plan, paid, subscriptionStatus, sessionId } = extractFulfillment(event)

  // Not an event we act on. Ack 200 so the sender stops — a 4xx here would
  // make it retry an event we will never do anything with.
  if (!HANDLED_EVENTS.has(type)) {
    return Response.json({ ok: true, ignored: true, type })
  }

  // A cancellation is observed and acked, never acted on. Builder has NO
  // downgrade path, and inventing one from a webhook would let a single
  // spoofed-or-misordered event strip a paying founder's access. Core's
  // /api/v1/auth/me stays the authority on current entitlement (that is what
  // every paid gate reads via fetchCorePlanIdentity), so a real cancellation
  // takes effect there without Builder writing anything.
  if (type === 'customer.subscription.deleted') {
    console.log('[webhooks/stripe] subscription.deleted observed (no downgrade performed)', { slug, plan })
    return Response.json({ ok: true, type, slug: slug || undefined, downgraded: false })
  }

  // A subscription update only re-asserts the plan while the subscription is
  // genuinely ACTIVE (or trialing). past_due/unpaid/canceled must never stamp.
  if (type === 'customer.subscription.updated') {
    const active = subscriptionStatus === 'active' || subscriptionStatus === 'trialing'
    if (!active) {
      return Response.json({ ok: true, type, reason: 'subscription_not_active', status: subscriptionStatus || undefined })
    }
  } else if (!paid) {
    // checkout.session.completed can legitimately arrive unpaid (async payment
    // methods). Nothing to fulfill until it actually settles.
    return Response.json({ ok: true, reason: 'not_paid', type, sessionId: sessionId || undefined })
  }

  if (!slug) {
    // A real purchase we cannot attribute to a company. Acked (retrying won't
    // add a slug) but logged loudly — this is an operator-actionable gap, and
    // the founder's own Live load will still reconcile via #855.
    console.warn('[webhooks/stripe] paid event with no resolvable company slug', { type, sessionId, plan })
    return Response.json({ ok: true, reason: 'no_slug', type, sessionId: sessionId || undefined })
  }

  if (!plan) {
    console.warn('[webhooks/stripe] paid event with no resolvable plan id', { type, slug, sessionId })
    return Response.json({ ok: true, reason: 'no_plan', type, slug })
  }

  // Confirm Builder actually owns this company before writing — and critically,
  // tell "confirmed not in the registry" apart from "the registry lookup itself
  // failed" (#1012 review finding 2).
  //
  // This used to be `resolveApp(slug).catch(() => null)`, whose single `null`
  // return conflates both. A ZeroDB 5xx, a timeout, or a missing
  // ZERODB_PROJECT_ID therefore reported `company_not_found` and ACKED 200,
  // telling the sender to stop retrying and permanently discarding a real
  // payment for a company that exists perfectly well. `resolveAppVerified`
  // (#807/#832) was built for exactly this conflation and carries the `verified`
  // flag that answers it.
  const lookup = await resolveAppVerified(slug).catch(() => ({ entry: null, verified: false }))

  if (!lookup.verified) {
    // COULD NOT CHECK. The event is real and still unfulfilled, and a retry can
    // genuinely succeed once the registry is reachable — so ask for one. Nothing
    // is written on an answer we cannot trust (including the case where an entry
    // came back alongside verified:false; an untrusted read is untrusted either
    // way).
    console.error(
      '[webhooks/stripe] registry lookup UNVERIFIED — cannot distinguish a missing company ' +
        'from an unreachable registry, so asking the sender to retry rather than acking and ' +
        'discarding a real payment',
      { type, slug, plan },
    )
    return Response.json(
      { ok: false, reason: 'registry_lookup_failed', retryable: true, type, slug },
      { status: 503 },
    )
  }

  if (!lookup.entry) {
    // CONFIRMED GONE. Acked (not 404'd, not 5xx'd): retrying will never make
    // this company exist, so the sender should stop. Logged loudly because a
    // real payment for an unknown slug is operator-actionable.
    console.warn('[webhooks/stripe] paid event for a company CONFIRMED not in the registry', { type, slug, plan })
    return Response.json({ ok: true, reason: 'company_not_found', type, slug })
  }

  // THE ACTUAL FIX: the same shared fulfillment the browser-redirect path uses,
  // with no browser involved. No jwt — see the file header: the tmp_ key claim
  // needs the founder's own token, so it is reported as pending rather than
  // attempted with a borrowed identity.
  let result: Awaited<ReturnType<typeof fulfillPaidPlan>>
  try {
    result = await fulfillPaidPlan(slug, plan)
  } catch (e: any) {
    // A THROWN fulfillment is a transient WRITE failure (#1012 review finding
    // 2), not a decision. This used to ack 200, which told the sender the
    // payment was handled while the company sat unfulfilled — the same
    // fail-open as the lookup above, and leaning on #855's reconciliation as
    // the only recovery meant it only ever fired for a founder who happened to
    // revisit Live. Asking for a retry is the correct response to a wobbling
    // ZeroDB; the sender's own backoff, not a 200, is what prevents a storm.
    console.error('[webhooks/stripe] fulfillment threw — asking the sender to retry', {
      slug, plan, error: String(e?.message || e),
    })
    return Response.json(
      { ok: false, reason: 'fulfillment_failed', retryable: true, type, slug, plan },
      { status: 503 },
    )
  }

  // A reported (not thrown) WRITE failure is equally transient and equally
  // retryable. Every other `!ok` reason — `not_a_paid_plan`, `not_registered`,
  // `missing_args` — is a deterministic refusal that a retry would reproduce
  // exactly, so those stay 200 acks below.
  if (!result.ok && result.reason === 'plan_write_failed') {
    console.error('[webhooks/stripe] plan write FAILED — asking the sender to retry', { slug, plan })
    return Response.json(
      { ok: false, reason: 'plan_write_failed', retryable: true, type, slug, plan },
      { status: 503 },
    )
  }

  // Record the paid conversion in the recursive learning loop, mirroring what
  // subscription/verify does. Strictly after the response-shaping work above
  // and never awaited — the webhook ack must not wait on it, and a failure
  // here must never turn a successful fulfillment into an error.
  if (result.planSet) {
    markConverted(slug, plan).catch(() => {})
  }

  if (result.keyClaimPending) {
    // Visible, greppable record that this company's tmp_ → permanent upgrade is
    // still outstanding and can ONLY be finished by an authenticated founder
    // request (reconcilePlanFulfillment on their next Live load).
    console.warn('[webhooks/stripe] plan stamped but tmp_ key claim still pending (needs founder session)', {
      slug, plan,
    })
  }

  return Response.json({
    ok: result.ok,
    type,
    slug,
    plan,
    planSet: result.planSet,
    keyClaimed: result.keyClaimed,
    keyClaimPending: result.keyClaimPending,
    reason: result.ok ? undefined : result.reason,
  })
}
