/**
 * CORS headers for Builder's ACP (Agentic Commerce Protocol) endpoints
 * (#2173, AX/agent-readiness scan 2026-11-19; widened #2183).
 *
 * Both `/checkout_sessions` and `/agentic_commerce/delegate_payment` accept
 * ANY caller — there is no per-caller auth check on the incoming request
 * (Builder signs the OUTBOUND request to core itself, via
 * lib/build/acp-signature.ts; the caller never sends that signature).
 * `Access-Control-Allow-Origin: *` is therefore the honest value, matching
 * these routes' existing "anonymous caller" posture — never a credentialed
 * CORS response (which would also require dropping `*` for a reflected
 * origin + `Access-Control-Allow-Credentials`, a different trust model this
 * endpoint doesn't have).
 *
 * `Access-Control-Allow-Headers` lists `Content-Type` and `Idempotency-Key`
 * — the headers each route's own POST handler actually reads from the
 * incoming request (confirmed by grepping both files for
 * `request.headers.get(...)`) — PLUS `Authorization`, included even though
 * neither route currently reads it.
 *
 * #2183 — the original #2173 fix omitted `Authorization` on the reasoning
 * that advertising an unused header "implies a contract that doesn't
 * exist." That reasoning conflated two different things: ADVERTISING a
 * header as CORS-allowed only tells a browser-based caller's preflight
 * that the header won't be stripped — it does not claim the server reads
 * or validates it. A genuinely ACP-conformant client runtime may send
 * `Authorization` by convention regardless of whether this specific
 * implementation checks it today; omitting it from the preflight response
 * blocks that real request before it's even attempted. Confirmed via the
 * AX scanner itself: it continued to fail this check against the narrower
 * list even though the narrower list was verified live and correct for
 * what Builder's code actually reads.
 */
export const ACP_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, Authorization',
  'Access-Control-Max-Age': '600',
}
