/**
 * ZeroCommerce provisioning client (#417, child of #414).
 *
 * ZeroCommerce (the AINative ecommerce primitive) authenticates with the same
 * AINative JWT bearer the founder signs in with — confirmed via its real
 * OpenAPI spec (`HTTPBearer` security scheme), the same direct-bearer pattern
 * already proven for ZeroPipeline (lib/build/zeropipeline.ts). No OAuth
 * redirect, no separate credential type.
 *
 * Real, confirmed contract (see #417):
 *   POST /api/v1/commerce/stores/onboard
 *   body: { name, slug, currency? } — "Create a merchant store. One store per
 *   owner user."
 *   201 on success; 400/401/403/404/422/500 documented error codes.
 *
 * No Idempotency-Key header is documented for this endpoint (unlike
 * ZeroPipeline's /pipelines). Since it's "one store per owner user," a repeat
 * call for an already-provisioned company most likely returns a 400
 * business-rule rejection rather than silently duplicating — this client
 * surfaces that 400 honestly (ok:false, real reason) rather than treating it
 * as a crash. This assumption is NOT verified against a live call (the
 * scoping issue flagged the same gap) — if it turns out a repeat call instead
 * returns the existing store, callers should treat a 400 here as
 * "likely already provisioned" rather than a hard failure; revisit once
 * verified against the real API.
 */

const ZC_BASE = process.env.ZEROCOMMERCE_API_URL || 'https://zerocommerce.ainative.studio/api/v1'

export interface ZeroCommerceResult {
  ok: boolean
  storeId?: string
  slug?: string
  reason?: string
  status?: number
}

/**
 * Create a company's ZeroCommerce store using the founder's JWT. Never
 * throws — a failure (auth, validation, or the documented "one store per
 * owner" business rule) is surfaced as a structured, honest result so the
 * caller can leave the Commerce card simulated rather than fabricate success.
 */
export async function provisionStore(jwt: string, slug: string, companyName: string): Promise<ZeroCommerceResult> {
  if (!jwt) return { ok: false, reason: 'no_jwt' }
  try {
    const res = await fetch(`${ZC_BASE}/commerce/stores/onboard`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: companyName || slug,
        slug,
      }),
      signal: AbortSignal.timeout(20000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, status: res.status, reason: String(data?.message || data?.detail || res.status).slice(0, 160) }
    }
    return { ok: true, storeId: String(data?.id || data?.store?.id || ''), slug: String(data?.slug || slug), status: res.status }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}
