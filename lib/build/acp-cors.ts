/**
 * CORS headers for Builder's ACP (Agentic Commerce Protocol) endpoints
 * (#2173, AX/agent-readiness scan 2026-11-19).
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
 * `Access-Control-Allow-Headers` lists exactly the headers each route's own
 * POST handler reads from the incoming request — confirmed by grepping both
 * files for `request.headers.get(...)` — not a guessed/generic list:
 * `Content-Type` (the JSON body) and `Idempotency-Key` (forwarded verbatim
 * to core's real idempotency_service when present). Neither route reads an
 * `Authorization` header from the caller — core's own ACP endpoint doesn't
 * expect one either (confirmed: no `Authorization` handling in
 * acp_checkout.py) — so it is deliberately NOT advertised here; adding it
 * would imply a caller-auth contract that doesn't exist.
 */
export const ACP_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
  'Access-Control-Max-Age': '600',
}
