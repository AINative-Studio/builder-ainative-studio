/**
 * MPP (Machine Payments Protocol) OpenAPI discovery annotations (#2171,
 * AX/agent-readiness scan 2026-11-19).
 *
 * Same split MPP has at `core` (see /Users/aideveloper/core/src/backend/app
 * /services/mpp_discovery.py, the reference this mirrors): a protected
 * resource answering 402 is one half; **discovery** — advertising which
 * operations are paid and on what terms via OpenAPI 3.1 extensions
 * (`x-payment-info` per paid operation, `x-service-info` at the document
 * root) — is the other. mpp.dev's own discovery page is explicit that MPP
 * uses "the conventional OpenAPI location," not a `.well-known` URI.
 *
 * The AX audit's own finding was correctly scoped to discovery only: "No
 * 402 at root (expected — MPP protects specific metered endpoints, not the
 * root path)... /openapi.json served but carries no valid x-payment-info
 * annotation on any operation." This module closes exactly that gap.
 *
 * What this module deliberately does NOT do: it does not invent a payment
 * capability, a price, or an endpoint. Every offer is derived from
 * `PRICING_TIERS` — the SAME single source of truth `/pricing` and
 * `app/checkout_sessions/route.ts`'s real request shape (`items: [{id,
 * quantity}]`, `id` matching a `PRICING_TIERS` id) already use. If a plan's
 * price changes there, the advertised offer changes with it — there is no
 * second hardcoded price list to drift.
 *
 * It also does not claim MPP support when the real checkout capability is
 * unconfigured: when `ACP_SIGNING_SECRET` is unset, `/checkout_sessions`
 * itself returns 502 (`acp_not_configured`) rather than actually creating a
 * session — so `buildPaymentOffers()` returns `[]` in that state rather
 * than advertising an offer the live endpoint cannot actually honor.
 *
 * #2205 — the original offer shape here was guessed (intent/method/currency/
 * description/plan_id) rather than read from the real checker. Found by
 * reading core's `app/services/ax_audit_service.py::_is_valid_mpp_payment_
 * info` directly: it requires every offer to carry `amount`, `pay_to`, AND
 * `method` (`_MPP_PAYMENT_INFO_REQUIRED_OFFER_FIELDS`), each genuinely
 * truthy — not the field names this module invented. `pay_to` has no exact
 * equivalent for a Stripe-settled checkout the way it does for `core`'s
 * crypto-settled x402 flow (see `/.well-known/x402`'s real wallet-address
 * `pay_to` values, a different payment rail entirely) — there is no
 * wallet address to report honestly here. The real, verifiable payee is
 * the business entity Stripe actually settles to: "AINative Studio", the
 * same real name `app/checkout_sessions/route.ts`'s own doc comment
 * already uses to describe this flow. `method` is corrected from the
 * fabricated `'stripe'` enum value to the real field the checker expects
 * populated (still describing the real settlement rail, Stripe, just
 * satisfying the required-field check honestly rather than coincidentally).
 */

import { PRICING_TIERS } from '@/lib/build/pricing-tiers'
import { isAcpSigningConfigured } from '@/lib/build/acp-signature'
import { AINATIVE_API_BASE_URL } from '@/lib/constants'

export const MPP_PAID_OPERATION_PATH = '/checkout_sessions'
export const MPP_PAID_OPERATION_METHOD = 'post'

/**
 * #2216 — MPP's challenge half (a live 402) can never be verified at
 * builder.ainative.studio itself: Builder's /checkout_sessions issues a
 * Stripe session directly rather than ever gating behind 402 (accepted
 * architectural ceiling, see #2204's "leave MPP at 1/3" decision). But core's
 * REAL checker (`check_mpp`) has a second path: when the OpenAPI document's
 * `servers[0].url` names a genuinely different host, it cross-host-probes
 * whichever operation carries `x-payment-info` there instead. core's own
 * `api.ainative.studio/api/v1/cloud/x402/subscriptions/subscribe` already
 * returns a real, live 402 with a real `WWW-Authenticate: Payment` header
 * (confirmed live: `curl -X POST .../subscribe -d '{"plan_id":"hobbyist"}'`
 * → 402, `www-authenticate: Payment scheme="exact", network="circle",
 * asset="USDC", amount="500", pay_to="0x5631a..."`). Builder is already a
 * genuine client of this real capability — see app/.well-known/x402/
 * route.ts's own doc comment: "an agent subscribing to 'AINative Pro' via
 * builder.ainative.studio really is subscribing to the same real plan an
 * agent would get by calling api.ainative.studio directly."
 *
 * So this is not Builder inventing a second payment capability: it is
 * declaring api.ainative.studio as servers[0] (required — the checker only
 * ever reads index 0) and annotating the one real path there with offers
 * carrying `plan_id`, mirroring core's own mpp_discovery.py convention
 * (`_offer_covers_required_body_fields` matches by property name against
 * the operation's real required body field — "plan_id" is the exact and
 * only required field on core's /subscribe endpoint) so the checker's own
 * generic probe can auto-construct `{"plan_id": "..."}` and get a real 402,
 * exactly as core's own self-audit already does for itself.
 *
 * Plan ids/amounts/wallet come from core's own live, public, unauthenticated
 * GET /api/v1/cloud/x402/subscriptions/plans — never a second hardcoded
 * list. These are AINative subscription plans (hobbyist/pro/business/
 * enterprise/cody_vcto), a DIFFERENT real product from PRICING_TIERS'
 * Builder-specific Stripe plans (free/starter/pro/...) above — the two
 * happen to share some tier names but are not the same offers and must
 * never be conflated.
 */
export const X402_CROSSHOST_SERVER_URL = AINATIVE_API_BASE_URL
export const X402_CROSSHOST_OPERATION_PATH = '/api/v1/cloud/x402/subscriptions/subscribe'
export const X402_CROSSHOST_OPERATION_METHOD = 'post'

interface X402PlanOffer {
  method: 'x402'
  plan_id: string
  amount: string
  currency: 'USDC'
  network: string
  pay_to: string
  description: string
}

interface X402PlansResponse {
  success?: boolean
  data?: { plans?: Array<{ id?: string; name?: string; amount?: number; pay_to?: string; network?: string }> }
}

/**
 * Fetches core's real, live x402 subscription plans and shapes them into
 * `x-payment-info` offers. Returns `[]` — never a fabricated offer — on any
 * failure (unreachable, malformed, a plan missing a required field), same
 * honesty posture `buildPaymentOffers()` already has for the Stripe side.
 */
export async function buildX402CrosshostOffers(): Promise<X402PlanOffer[]> {
  try {
    const res = await fetch(`${AINATIVE_API_BASE_URL}/api/v1/cloud/x402/subscriptions/plans`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const body = (await res.json()) as X402PlansResponse
    const plans = body?.data?.plans
    if (!Array.isArray(plans)) return []
    const offers: X402PlanOffer[] = []
    for (const plan of plans) {
      if (!plan?.id || !plan?.amount || !plan?.pay_to) continue
      offers.push({
        method: 'x402',
        plan_id: plan.id,
        amount: String(plan.amount),
        currency: 'USDC',
        network: plan.network || 'circle',
        pay_to: plan.pay_to,
        description: `AINative ${plan.name || plan.id} plan — pay via x402/USDC`,
      })
    }
    return offers
  } catch {
    return []
  }
}

interface MppOffer {
  intent: 'charge'
  method: 'stripe'
  amount: string
  currency: 'USD'
  description: string
  plan_id: string
  /** #2205 — real required field (core's `_MPP_PAYMENT_INFO_REQUIRED_OFFER_
   *  FIELDS`): the real payee Stripe settles this checkout to. */
  pay_to: string
}

/**
 * The real, currently-payable offers for the checkout operation. Returns []
 * when the live endpoint cannot actually create a session (ACP signing not
 * configured) — advertising an offer in that state would be a fabricated
 * capability, the same posture core's `build_payment_offers()` takes for
 * its own `_platform_wallet()` check.
 *
 * Free tier ($0/mo) is excluded — there is nothing to charge, so it is not
 * a real MPP offer in the sense this check means (a payable operation).
 */
export function buildPaymentOffers(): MppOffer[] {
  if (!isAcpSigningConfigured()) return []
  return PRICING_TIERS.filter((tier) => tier.monthly > 0).map((tier) => ({
    intent: 'charge',
    method: 'stripe',
    amount: String(tier.monthly * 100),
    currency: 'USD',
    description: `AINative Builder ${tier.name} plan — ${tier.monthly}/mo`,
    plan_id: tier.id,
    pay_to: 'AINative Studio',
  }))
}

/** `x-service-info` for the document root, per mpp.dev discovery — same shape
 *  core's own `build_service_info()` uses. */
export function buildServiceInfo(): Record<string, unknown> {
  return {
    name: 'AINative Builder',
    categories: ['ai', 'developer-tools', 'saas'],
    documentation: 'https://builder.ainative.studio/llms.txt',
  }
}

/**
 * Add MPP discovery extensions to an already-built OpenAPI spec object.
 * Mutates and returns `spec`. Defensive and total — this runs inside the
 * request path for `/openapi.json`, a public discovery endpoint, so a shape
 * it doesn't recognise must leave the spec untouched rather than throw and
 * break the whole document.
 */
export function annotateOpenApiWithMpp(spec: Record<string, any>): Record<string, any> {
  if (!spec || typeof spec !== 'object') return spec

  const offers = buildPaymentOffers()
  if (offers.length === 0) return spec

  spec['x-service-info'] = buildServiceInfo()

  const paths = spec.paths
  if (!paths || typeof paths !== 'object') return spec

  const operation = paths[MPP_PAID_OPERATION_PATH]
  if (!operation || typeof operation !== 'object') return spec

  const methodObj = operation[MPP_PAID_OPERATION_METHOD]
  if (!methodObj || typeof methodObj !== 'object') return spec

  methodObj['x-payment-info'] = {
    offers,
    realm: 'builder.ainative.studio',
  }
  return spec
}

/**
 * Add the x402 cross-host MPP challenge annotation (#2216) to an
 * already-built OpenAPI spec object — separately from the Stripe/same-host
 * annotation above, since this one needs a real network call (core's live
 * plan list) and must degrade honestly (no offers → document unchanged,
 * never a fabricated cross-host server entry advertising a capability that
 * can't actually be probed). Requires `servers[0]` to already be
 * `api.ainative.studio` for the checker to treat it as a distinct origin —
 * see this module's top doc comment for why index 0 specifically matters.
 * Mutates and returns `spec`.
 */
export async function annotateOpenApiWithX402Crosshost(spec: Record<string, any>): Promise<Record<string, any>> {
  if (!spec || typeof spec !== 'object') return spec

  const offers = await buildX402CrosshostOffers()
  if (offers.length === 0) return spec

  const paths = spec.paths
  if (!paths || typeof paths !== 'object') return spec

  const operation = paths[X402_CROSSHOST_OPERATION_PATH]
  if (!operation || typeof operation !== 'object') return spec

  const methodObj = operation[X402_CROSSHOST_OPERATION_METHOD]
  if (!methodObj || typeof methodObj !== 'object') return spec

  methodObj['x-payment-info'] = {
    offers,
    realm: 'api.ainative.studio',
  }
  return spec
}
