/**
 * GET /.well-known/x402 — x402 agent-payment discovery document (#1835,
 * supersedes #1682's deliberate "unsupported" answer).
 *
 * #1682 correctly found that Builder itself has no business initiating
 * on-chain payments through a shared platform key, and declared
 * `x402_supported: false` rather than fake a payment capability Builder
 * didn't have. That conclusion was right for "does BUILDER execute x402
 * payments" — but wrong for "is there a real x402 discovery document to
 * serve," because it never checked whether `core` (api.ainative.studio,
 * the real backend Builder is a client of) already had one. It does:
 * core#9247 shipped a real, live `/.well-known/x402` (core's
 * `x402_discovery` handler in src/backend/app/main.py), listing core's
 * own real, purchasable AINative subscription plans
 * (X402SubscriptionService.X402_PLANS), settled against a real production
 * wallet (X402_PLATFORM_WALLET_ADDRESS) via Circle.
 *
 * This route fetches that real document from core and passes it through
 * verbatim. It is NOT Builder inventing payment capability — Builder is a
 * client of core exactly like it is for every other primitive (ZeroCommerce,
 * ZeroDB, etc.), and an agent subscribing to "AINative Pro" via
 * builder.ainative.studio really is subscribing to the same real plan an
 * agent would get by calling api.ainative.studio directly. No fabricated
 * fields, no Builder-side wallet/network invented — whatever core serves
 * is what gets served here, so this document can never drift out of sync
 * with the real payment-requirements core's own 402 challenge enforces.
 *
 * Falls back to an empty-but-honest document (not #1682's old "unsupported"
 * document, which would be a lie now) if core is unreachable, so a
 * transient upstream hiccup degrades cleanly rather than returning a 502
 * or misrepresenting support status.
 */

const CORE_X402_URL = `${process.env.AINATIVE_API_BASE_URL || 'https://api.ainative.studio'}/.well-known/x402`

const FALLBACK = {
  x402_version: 1,
  accepts: [] as Array<Record<string, unknown>>,
  note: 'Upstream x402 discovery document (api.ainative.studio) was unreachable; no payment requirements available right now.',
}

export async function GET() {
  try {
    const res = await fetch(CORE_X402_URL, {
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
