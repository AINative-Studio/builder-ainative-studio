/**
 * GET /.well-known/ucp — Universal Commerce Protocol discovery document
 * (#1838, discovery half).
 *
 * Same pattern as /.well-known/x402 (#1835): core (api.ainative.studio)
 * already serves a real, live UCP discovery document — core#9247's
 * `ucp_discovery` handler in src/backend/app/main.py, listing core's real
 * Stripe subscription plans (plan_catalog_service.STRIPE_PRICE_IDS), its
 * real x402 crypto-payment capability, and its real AP2 mandate-
 * verification capability. This fetches and passes it through verbatim —
 * Builder doesn't invent a second, possibly-drifting copy of what
 * commerce capabilities actually exist.
 *
 * The execution half of #1838 (ACP's POST /checkout_sessions and
 * POST /agentic_commerce/delegate_payment) lives at the apex, matching
 * the ACP spec's required mount points — see app/checkout_sessions/route.ts
 * and app/agentic_commerce/delegate_payment/route.ts.
 */

const CORE_UCP_URL = `${process.env.AINATIVE_API_BASE_URL || 'https://api.ainative.studio'}/.well-known/ucp`

const FALLBACK = {
  version: 'unavailable',
  capabilities: [] as Array<Record<string, unknown>>,
  note: 'Upstream UCP discovery document (api.ainative.studio) was unreachable; no commerce capabilities available right now.',
}

export async function GET() {
  try {
    const res = await fetch(CORE_UCP_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      return Response.json(FALLBACK, { status: 200, headers: { 'Cache-Control': 'no-store' } })
    }
    const doc = await res.json()
    return Response.json(doc, { headers: { 'Cache-Control': 'public, max-age=300' } })
  } catch {
    return Response.json(FALLBACK, { status: 200, headers: { 'Cache-Control': 'no-store' } })
  }
}
