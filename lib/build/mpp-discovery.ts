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
 */

import { PRICING_TIERS } from '@/lib/build/pricing-tiers'
import { isAcpSigningConfigured } from '@/lib/build/acp-signature'

export const MPP_PAID_OPERATION_PATH = '/checkout_sessions'
export const MPP_PAID_OPERATION_METHOD = 'post'

interface MppOffer {
  intent: 'charge'
  method: 'stripe'
  amount: string
  currency: 'USD'
  description: string
  plan_id: string
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
